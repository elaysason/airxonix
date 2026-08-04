/*
 * render3d.js — Three.js render layer for AirXonix.
 *
 * DESIGN: this file is a READ-ONLY MIRROR of the game state. It never mutates
 * `grid`, player position, enemies or score. Every frame it reads the globals
 * owned by game.js (grid, player, enemyGroup, powerupGroup, activePowerups) and
 * draws a 3D representation of them. That keeps all gameplay logic — movement,
 * flood-fill capture, enemy physics — exactly as it was in the 2D version.
 *
 * Phaser still runs the simulation and renders its own transparent canvas ON TOP
 * of this one, where it draws text/HUD effects only. Use projectToScreen() to
 * place those 2D overlays over the right spot in the 3D scene.
 *
 * Coordinate mapping: game pixel (x, y) -> world (x, height, y).
 * The board plane is y = 0, spanning x 0..800 and z 0..600.
 */
(function () {
    'use strict';

    const TILE = 20;
    const COLS_3D = 40;
    const ROWS_3D = 30;
    const BOARD_W = COLS_3D * TILE; // 800
    const BOARD_H = ROWS_3D * TILE; // 600
    const MAX_CELLS = COLS_3D * ROWS_3D;

    // Block heights. Land is a chunky slab, trail is a thin glowing ribbon.
    const LAND_H = 10;
    const TRAIL_H = 8;

    // Captured land rests at a vivid emerald-green (with a steady glow, see
    // LAND_REST_EI) and only animates while capturing. It stays clearly distinct
    // from the cyan arena border, the magenta trail and the yellow player.
    const COLOR_LAND = 0x2ecb45;
    const COLOR_TRAIL = 0xff00ff;
    const COLOR_PLAYER = 0xedff21;

    const ENEMY_COLORS = {
        normal: 0xffaa00,
        destroyer: 0xff3333,
        homing: 0x9900ff,
        fast: 0x00ffff,
        bouncer: 0x00ff66
    };

    let renderer, scene, camera, clock;
    let landMesh, trailMesh;
    let playerMesh, playerLight, shieldMesh;
    let floorMesh, gridHelper;
    let flashOverlay;

    // Per-cell rise animation (0 = flat, 1 = full height) so newly captured
    // territory pops up instead of appearing instantly.
    let landAnim = [];
    // Cheap allocation-free change detector for the 40x30 grid. The previous
    // version built a 1,200-character string every frame (40 Array.join calls +
    // concatenation), which was the single biggest source of GC pressure here.
    let lastGridHash = -1;
    let landAnimating = true;
    let ready = false;

    // Monotonic frame counter used to mark pooled meshes as "seen this frame",
    // which replaces allocating a Set per group per frame.
    let frameId = 0;

    // Screen shake state, driven by shake().
    let shakeTime = 0, shakeDuration = 0, shakeIntensity = 0;
    let flashAlpha = 0, flashDecay = 0;
    let lastDeadState = null;

    // Captured-land colour state. The land rests at a static "alive" glow and
    // only animates (a quick bright green flare that settles) while a capture
    // is happening, driven by pulseLand(). landSettled tracks whether the resting
    // look has been written, so idle frames skip the material update entirely.
    const LAND_REST_EI = 0.5;            // resting emissive strength ("alive")
    let landPulseTime = 0, landPulseDuration = 0;
    let landSettled = false;

    // Reusable scratch objects — avoids allocating per frame.
    const _m4 = new THREE.Matrix4();
    const _quat = new THREE.Quaternion();
    const _pos = new THREE.Vector3();
    const _scale = new THREE.Vector3();
    const _proj = new THREE.Vector3();

    // Pools of meshes keyed by the live Phaser object, so enemies/powerups that
    // are destroyed mid-level get their 3D counterpart removed too.
    const enemyMeshes = new Map();
    const powerupMeshes = new Map();

    const cameraBase = new THREE.Vector3();
    const cameraTarget = new THREE.Vector3();

    // Camera framing. Orthographic projection keeps every board corner square
    // and every grid cell the same size while the tilt still exposes 3D height.
    const CAMERA_TILT_DEG = 72;
    const CAMERA_FIT = 0.9; // fraction of the viewport the board should span

    /**
     * Place an orthographic camera along a fixed tilt and size its frustum to
     * contain the board. Parallel projection removes the trapezoid/cut-corner
     * effect that perspective introduced.
     */
    function fitCamera() {
        const tilt = THREE.MathUtils.degToRad(CAMERA_TILT_DEG);
        const dir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
        camera.position.copy(cameraTarget).addScaledVector(dir, 1400);
        camera.lookAt(cameraTarget);
        cameraBase.copy(camera.position);
    }

    function init() {
        const stage = document.getElementById('stage');
        if (!stage || typeof THREE === 'undefined') return;

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x02040c);
        scene.fog = new THREE.Fog(0x02040c, 1, 2);

        const halfW = BOARD_W / (2 * CAMERA_FIT);
        const halfH = BOARD_H / (2 * CAMERA_FIT);
        camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 1, 6000);
        cameraTarget.set(BOARD_W / 2, 0, BOARD_H / 2);
        fitCamera();

        // Fog range depends on how far fitCamera pushed the camera back; derive
        // it so the far edge gets a subtle depth falloff without washing out.
        const camDist = cameraBase.distanceTo(cameraTarget);
        scene.fog.near = camDist * 0.85;
        scene.fog.far = camDist * 2.1;

        renderer = new THREE.WebGLRenderer({
            // MSAA is the most expensive knob here. On high-density screens the
            // extra device pixels already hide the aliasing, so only pay for it
            // on 1x displays.
            antialias: window.devicePixelRatio < 1.5,
            alpha: false,
            powerPreference: 'high-performance',
            stencil: false,
            depth: true
        });
        // Two WebGL canvases are stacked (Three.js + Phaser). Cap DPR so high
        // density screens do not make both render 4x the pixel count.
        // The board fills nearly the whole viewport, so fragment cost dominates.
        // Cap at 1 device pixel per CSS pixel: the old 1.25 cap rendered a
        // 1000x750 buffer (56% more pixels) for detail the tilt already hides.
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
        renderer.setSize(BOARD_W, BOARD_H, false);
        renderer.shadowMap.enabled = true;
        // Basic (unfiltered) shadows at half the old resolution. Only the player
        // and the enemies cast now, so the map covers very little geometry and
        // PCF's extra taps bought almost nothing visually.
        renderer.shadowMap.type = THREE.BasicShadowMap;

        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        renderer.domElement.id = 'three-canvas';
        stage.appendChild(renderer.domElement);

        clock = new THREE.Clock();

        buildLights();
        buildFloor();
        buildTiles();
        buildPlayer();
        buildFlashOverlay();
        resetAnim();

        ready = true;
        renderer.setAnimationLoop(frame);
    }

    function buildLights() {
        // One hemisphere light replaces the old ambient+hemisphere pair: it does
        // the same sky/ground fill in a single term, and every light removed is
        // fragment work saved on all 1,200 instanced blocks.
        scene.add(new THREE.HemisphereLight(0x3a5f8d, 0x0a1020, 1.15));

        const key = new THREE.DirectionalLight(0xbbeeff, 0.75);
        key.position.set(BOARD_W * 0.25, 900, -260);
        key.target.position.copy(cameraTarget);
        key.castShadow = true;
        key.shadow.mapSize.set(512, 512);
        // Orthographic shadow frustum sized to the board, otherwise the shadow
        // map covers a huge empty area and the shadows turn blocky.
        const cam = key.shadow.camera;
        cam.left = -700; cam.right = 700;
        cam.top = 700; cam.bottom = -700;
        cam.near = 100; cam.far = 2200;
        key.shadow.bias = -0.0016;
        scene.add(key);
        scene.add(key.target);

        // Cool rim light from the opposite side for the neon look.
        const rim = new THREE.DirectionalLight(0x00f3ff, 0.35);
        rim.position.set(BOARD_W + 400, 320, BOARD_H + 300);
        scene.add(rim);
    }

    function buildFloor() {
        // The "void" the player must claim — sits just below the board plane.
        // Lambert instead of Standard: the board and this plane cover almost the
        // entire screen, and the PBR BRDF (GGX + IBL terms) is by far the most
        // expensive part of every one of those fragments. The look here is
        // emissive-dominated neon, so the specular response was barely visible.
        const geo = new THREE.PlaneGeometry(BOARD_W, BOARD_H);
        const mat = new THREE.MeshLambertMaterial({
            color: 0x070d1c,
            emissive: 0x020711,
            emissiveIntensity: 0.45
        });
        floorMesh = new THREE.Mesh(geo, mat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.set(BOARD_W / 2, -0.5, BOARD_H / 2);
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);

        gridHelper = new THREE.GridHelper(BOARD_W, COLS_3D, 0x174665, 0x0a2336);
        gridHelper.position.set(BOARD_W / 2, 0.2, BOARD_H / 2);
        gridHelper.scale.z = BOARD_H / BOARD_W;
        gridHelper.material.transparent = true;
        gridHelper.material.opacity = 0.3;
        scene.add(gridHelper);

        // The old arena halo plane sat at y = -5, i.e. underneath an opaque
        // floor that covers the exact same rectangle. It was never visible, but
        // it still cost a full-screen alpha-blended pass every single frame.
    }

    function buildTiles() {
        // Tiny gaps preserve the cell topology. The previous seamless slab made
        // captured territory and the border look like one giant cyan wall.
        const landGeo = new THREE.BoxGeometry(TILE * 0.94, LAND_H, TILE * 0.94);
        const landMat = new THREE.MeshLambertMaterial({
            // Dark base so the blue hemisphere sky light has little diffuse to
            // tint; the self-lit green emissive then dominates and reads as a
            // saturated emerald rather than a washed-out mint.
            color: 0x05391b,
            emissive: COLOR_LAND,
            emissiveIntensity: LAND_REST_EI
        });
        landMesh = new THREE.InstancedMesh(landGeo, landMat, MAX_CELLS);
        landMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // Land is the ground itself: it receives the player/enemy shadows but
        // does not cast. Casting from up to 1,200 instances doubled the whole
        // scene's geometry every frame for shadows nothing could actually see.
        landMesh.castShadow = false;
        landMesh.receiveShadow = true;
        landMesh.frustumCulled = false;
        scene.add(landMesh);

        const trailGeo = new THREE.BoxGeometry(TILE * 0.62, TRAIL_H, TILE * 0.62);
        const trailMat = new THREE.MeshLambertMaterial({
            color: COLOR_TRAIL,
            emissive: 0xff00ff,
            emissiveIntensity: 1.35
        });
        trailMesh = new THREE.InstancedMesh(trailGeo, trailMat, MAX_CELLS);
        trailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // The trail is a self-lit neon ribbon; shadows on it were invisible.
        trailMesh.castShadow = false;
        trailMesh.receiveShadow = false;
        trailMesh.frustumCulled = false;
        scene.add(trailMesh);
    }

    function buildPlayer() {
        const group = new THREE.Group();
        const geo = new THREE.OctahedronGeometry(TILE * 0.58);
        const mat = new THREE.MeshStandardMaterial({
            color: COLOR_PLAYER,
            emissive: COLOR_PLAYER,
            emissiveIntensity: 0.75,
            roughness: 0.25,
            metalness: 0.3
        });
        const core = new THREE.Mesh(geo, mat);
        core.castShadow = true;
        group.add(core);

        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(TILE * 0.7, 1.3, 8, 28),
            new THREE.MeshBasicMaterial({ color: COLOR_PLAYER, transparent: true, opacity: 0.8 })
        );
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
        playerMesh = group;
        playerMesh.userData.core = core;
        playerMesh.userData.ring = ring;
        scene.add(playerMesh);

        playerLight = new THREE.PointLight(COLOR_PLAYER, 1.4, 260, 2);
        scene.add(playerLight);

        // Shield bubble — shown only while the shield powerup is active.
        const sGeo = new THREE.SphereGeometry(TILE * 0.95, 20, 16);
        const sMat = new THREE.MeshBasicMaterial({
            color: 0x00ff66,
            transparent: true,
            opacity: 0.28,
            wireframe: true
        });
        shieldMesh = new THREE.Mesh(sGeo, sMat);
        shieldMesh.visible = false;
        scene.add(shieldMesh);
    }

    function buildFlashOverlay() {
        // A camera-locked white quad used for the big-capture flash. Kept in the
        // 3D scene (rather than the Phaser overlay) so it also covers the board.
        // The camera is orthographic, so the quad must be sized to the frustum
        // (a fixed 2x2 plane only covered the view under the old perspective
        // camera). Oversize slightly so screen shake can't reveal an edge.
        const w = (BOARD_W / CAMERA_FIT) * 1.3;
        const h = (BOARD_H / CAMERA_FIT) * 1.3;
        const geo = new THREE.PlaneGeometry(w, h);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false
        });
        flashOverlay = new THREE.Mesh(geo, mat);
        flashOverlay.frustumCulled = false;
        flashOverlay.renderOrder = 999;
        // Hidden while idle: an alpha-blended full-screen quad costs a whole
        // screen of blending every frame even at opacity 0.
        flashOverlay.visible = false;
        // Attaching to the camera keeps it filling the view regardless of shake.
        // Sits well inside the ortho near/far range (near = 1) so it is not clipped.
        flashOverlay.position.set(0, 0, -100);
        camera.add(flashOverlay);
        scene.add(camera);
    }

    function resetAnim() {
        landAnim = [];
        for (let x = 0; x < COLS_3D; x++) {
            landAnim[x] = new Float32Array(ROWS_3D);
        }
        lastGridHash = -1;
        landAnimating = true;
    }

    // Geometry/material caches. Enemies and powerups of the same type are
    // visually identical, so they share GPU resources: spawning one is then a
    // couple of Object3D allocations instead of tessellating a new solid and
    // compiling a new material (which also forces a shader program lookup).
    const enemyGeoCache = new Map();
    const enemyMatCache = new Map();
    const ringGeoCache = new Map();
    const ringMatCache = new Map();
    const powerupGeoCache = new Map();
    const powerupMatCache = new Map();

    function makeEnemyGeometry(type) {
        let geo = enemyGeoCache.get(type);
        if (geo) return geo;
        switch (type) {
            case 'fast':      geo = new THREE.OctahedronGeometry(TILE * 0.62); break;
            case 'bouncer':   geo = new THREE.BoxGeometry(TILE * 0.8, TILE * 0.8, TILE * 0.8); break;
            case 'destroyer': geo = new THREE.DodecahedronGeometry(TILE * 0.6); break;
            case 'homing':    geo = new THREE.IcosahedronGeometry(TILE * 0.6, 0); break;
            default:          geo = new THREE.SphereGeometry(TILE * 0.55, 18, 14); break;
        }
        enemyGeoCache.set(type, geo);
        return geo;
    }

    /** Shared thin orbital ring, keyed by radius/tube/colour/opacity. */
    function makeRing(radius, tube, radialSeg, tubeSeg, color, opacity) {
        const gKey = radius + ':' + tube + ':' + radialSeg + ':' + tubeSeg;
        let geo = ringGeoCache.get(gKey);
        if (!geo) {
            geo = new THREE.TorusGeometry(radius, tube, radialSeg, tubeSeg);
            ringGeoCache.set(gKey, geo);
        }
        const mKey = color + ':' + opacity;
        let mat = ringMatCache.get(mKey);
        if (!mat) {
            mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity });
            ringMatCache.set(mKey, mat);
        }
        const ring = new THREE.Mesh(geo, mat);
        ring.rotation.x = Math.PI / 2;
        return ring;
    }

    function makeEnemyMesh(type) {
        const color = ENEMY_COLORS[type] || ENEMY_COLORS.normal;
        let mat = enemyMatCache.get(type);
        if (!mat) {
            mat = new THREE.MeshStandardMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.7,
                roughness: 0.28,
                metalness: 0.42
            });
            enemyMatCache.set(type, mat);
        }
        const group = new THREE.Group();
        const core = new THREE.Mesh(makeEnemyGeometry(type), mat);
        core.castShadow = true;
        group.add(core);

        // Every enemy gets the same thin orbital ring. Type remains encoded by
        // core geometry + colour, while the shared silhouette makes the set feel
        // like one family instead of five unrelated primitives.
        const ring = makeRing(TILE * 0.72, 0.9, 6, 22, color, 0.58);
        group.add(ring);
        group.userData.core = core;
        group.userData.ring = ring;
        return group;
    }

    function makePowerupMesh(key) {
        const isShield = key === 'powerup_shield';
        const color = isShield ? 0x00ff00 : 0xff00ff;
        let geo = powerupGeoCache.get(key);
        if (!geo) {
            geo = isShield
                ? new THREE.TorusKnotGeometry(TILE * 0.34, TILE * 0.12, 48, 8)
                : new THREE.ConeGeometry(TILE * 0.45, TILE * 1.0, 5);
            powerupGeoCache.set(key, geo);
        }
        let mat = powerupMatCache.get(key);
        if (!mat) {
            mat = new THREE.MeshStandardMaterial({
                color: color, emissive: color, emissiveIntensity: 0.85,
                roughness: 0.25, metalness: 0.6
            });
            powerupMatCache.set(key, mat);
        }
        const group = new THREE.Group();
        const core = new THREE.Mesh(geo, mat);
        core.castShadow = true;
        group.add(core);
        const ring = makeRing(TILE * 0.7, 1.2, 8, 28, color, 0.72);
        group.add(ring);
        group.userData.core = core;
        group.userData.ring = ring;
        return group;
    }

    // ---- per-frame sync -------------------------------------------------

    function syncTiles(dt) {
        if (typeof grid === 'undefined' || !grid || !grid.length) return;

        // Most frames leave the 40x30 grid untouched; skipping 1,200 Matrix4
        // compositions plus two GPU buffer uploads on those frames is the
        // largest steady-state win in the renderer. The check itself is an
        // allocation-free FNV-style hash over the cell values.
        let hash = 2166136261;
        for (let x = 0; x < COLS_3D; x++) {
            const col = grid[x];
            if (!col) continue;
            for (let y = 0; y < ROWS_3D; y++) {
                hash ^= col[y] + x;
                hash = (hash * 16777619) | 0;
            }
        }
        const gridChanged = hash !== lastGridHash;
        if (!gridChanged && !landAnimating) return;
        lastGridHash = hash;

        let landCount = 0;
        let trailCount = 0;
        let stillAnimating = false;

        for (let x = 0; x < COLS_3D; x++) {
            const col = grid[x];
            if (!col) continue;
            for (let y = 0; y < ROWS_3D; y++) {
                const v = col[y];

                if (v === 1) {
                    // Ease the block up to full height on capture.
                    let a = landAnim[x][y];
                    if (a < 1) {
                        a = Math.min(1, a + dt * 5.5);
                        landAnim[x][y] = a;
                        if (a < 1) stillAnimating = true;
                    }
                    const eased = 1 - Math.pow(1 - a, 3);
                    const h = Math.max(0.001, LAND_H * eased);
                    _pos.set(x * TILE + TILE / 2, h / 2, y * TILE + TILE / 2);
                    _scale.set(1, h / LAND_H, 1);
                    _m4.compose(_pos, _quat.identity(), _scale);
                    landMesh.setMatrixAt(landCount++, _m4);
                } else {
                    // Cell was cleared (destroyer) — reset so it re-animates.
                    if (landAnim[x][y] !== 0) landAnim[x][y] = 0;

                    if (v === 2) {
                        _pos.set(x * TILE + TILE / 2, TRAIL_H / 2, y * TILE + TILE / 2);
                        _scale.set(1, 1, 1);
                        _m4.compose(_pos, _quat.identity(), _scale);
                        trailMesh.setMatrixAt(trailCount++, _m4);
                    }
                }
            }
        }

        landMesh.count = landCount;
        trailMesh.count = trailCount;
        landMesh.instanceMatrix.needsUpdate = true;
        trailMesh.instanceMatrix.needsUpdate = true;
        landAnimating = stillAnimating;
    }

    function syncPlayer(t) {
        if (typeof player === 'undefined' || !player || !player.active) {
            if (playerMesh) playerMesh.visible = false;
            if (shieldMesh) shieldMesh.visible = false;
            return;
        }
        playerMesh.visible = true;

        // Phaser player sprite has origin (0,0); its centre is half a tile in.
        const cx = player.x + TILE / 2;
        const cz = player.y + TILE / 2;
        const hover = LAND_H + TILE * 0.5 + Math.sin(t * 4) * 1.6;

        playerMesh.position.set(cx, hover, cz);
        playerMesh.userData.core.rotation.y = t * 1.6;
        playerMesh.userData.core.rotation.x = Math.sin(t * 2) * 0.18;
        playerMesh.userData.ring.rotation.z = t * 0.9;

        playerLight.position.set(cx, hover + 14, cz);

        // Mirror the 2D death tint: the cube turns hot orange on game over.
        // Only written when the state actually flips — assigning a colour marks
        // the material dirty and re-uploads its uniforms.
        const dead = typeof isGameOver !== 'undefined' && isGameOver;
        if (dead !== lastDeadState) {
            lastDeadState = dead;
            const hex = dead ? 0xff4500 : COLOR_PLAYER;
            playerMesh.userData.core.material.color.setHex(hex);
            playerMesh.userData.core.material.emissive.setHex(hex);
            playerMesh.userData.ring.material.color.setHex(hex);
            playerLight.color.setHex(hex);
        }

        const shieldOn = typeof activePowerups !== 'undefined' && activePowerups && activePowerups.shield;
        shieldMesh.visible = !!shieldOn;
        if (shieldOn) {
            shieldMesh.position.set(cx, hover, cz);
            shieldMesh.rotation.y = -t * 1.1;
            shieldMesh.rotation.x = t * 0.7;
            shieldMesh.scale.setScalar(1 + Math.sin(t * 6) * 0.06);
        }
    }

    // Generic pool sync: adds meshes for new objects, removes them for dead ones.
    // Meshes are stamped with the current frame id instead of collecting the live
    // objects into a freshly allocated Set on every single frame.
    function syncGroup(group, cacheMap, factory, place, t) {
        if (typeof group === 'undefined' || !group || !group.children) return;

        group.children.iterate(function (obj) {
            if (!obj || !obj.active) return;
            let mesh = cacheMap.get(obj);
            if (!mesh) {
                mesh = factory(obj);
                cacheMap.set(obj, mesh);
                scene.add(mesh);
            }
            mesh.userData.seen = frameId;
            place(mesh, obj, t);
        });

        cacheMap.forEach(function (mesh, obj) {
            if (mesh.userData.seen !== frameId) {
                scene.remove(mesh);
                // Geometries and materials are shared per type (see the caches
                // above), so they are deliberately NOT disposed here.
                cacheMap.delete(obj);
            }
        });
    }

    function syncEnemies(t) {
        syncGroup(
            typeof enemyGroup !== 'undefined' ? enemyGroup : null,
            enemyMeshes,
            function (ball) { return makeEnemyMesh(ball.enemyType || 'normal'); },
            function (mesh, ball) {
                // Enemy sprites are centre-origin, so x/y are already centres.
                mesh.position.set(ball.x, LAND_H + TILE * 0.45, ball.y);
                mesh.userData.core.rotation.x += 0.05;
                mesh.userData.core.rotation.y += 0.04;
                mesh.userData.ring.rotation.z -= 0.035;
            },
            t
        );
    }

    function syncPowerups(t) {
        syncGroup(
            typeof powerupGroup !== 'undefined' ? powerupGroup : null,
            powerupMeshes,
            function (p) { return makePowerupMesh(p.texture && p.texture.key); },
            function (mesh, p) {
                mesh.position.set(
                    p.x + TILE / 2,
                    LAND_H + TILE * 0.75 + Math.sin(t * 3) * 3,
                    p.y + TILE / 2
                );
                mesh.userData.core.rotation.y = t * 2;
                mesh.userData.ring.rotation.z = -t * 1.25;
            },
            t
        );
    }

    function applyCameraEffects(dt) {
        // The camera is static unless a shake is running. Re-copying the position
        // and calling lookAt() every frame forced a matrix/inverse recompute (and
        // therefore a full uniform re-upload) for no visual change.
        if (shakeTime > 0) {
            camera.position.copy(cameraBase);
            shakeTime -= dt;
            const k = Math.max(0, shakeTime / shakeDuration);
            const amp = shakeIntensity * k;
            camera.position.x += (Math.random() - 0.5) * amp;
            camera.position.y += (Math.random() - 0.5) * amp;
            camera.position.z += (Math.random() - 0.5) * amp;
            camera.lookAt(cameraTarget);
            if (shakeTime <= 0) {
                // Settle exactly back onto the rest pose.
                camera.position.copy(cameraBase);
                camera.lookAt(cameraTarget);
            }
        }

        if (flashAlpha > 0) {
            flashAlpha = Math.max(0, flashAlpha - flashDecay * dt);
            flashOverlay.material.opacity = flashAlpha;
            flashOverlay.visible = flashAlpha > 0;
        }
    }

    function frame() {
        if (!ready) return;
        const dt = Math.min(clock.getDelta(), 0.05);
        const t = clock.elapsedTime;
        frameId++;

        syncTiles(dt);
        syncPlayer(t);
        syncEnemies(t);
        syncPowerups(t);
        applyCameraEffects(dt);

        // The trail throbs fast (live/dangerous) every frame.
        trailMesh.material.emissiveIntensity = 1.15 + Math.sin(t * 8) * 0.35;

        // The captured land is a static "alive" green MOST of the time, and only
        // animates while a capture is happening: pulseLand() starts a quick flare
        // that brightens the glow and pushes the hue toward lime, then eases back
        // to the resting emerald. When idle we touch the material only once (the
        // "settle" write) so steady frames do no extra uniform work.
        if (landPulseTime > 0) {
            landPulseTime -= dt;
            const k = Math.max(0, landPulseTime / landPulseDuration); // 1 -> 0
            // Flare: brighter, and clearly shift emerald (0.40) -> lime-white
            // (higher lightness, lower saturation) so the colour visibly changes.
            landMesh.material.emissiveIntensity = LAND_REST_EI + k * 1.6;
            landMesh.material.emissive.setHSL(0.40 - k * 0.16, 0.95 - k * 0.4, 0.55 + k * 0.18);
            landSettled = false;
        } else if (!landSettled) {
            landMesh.material.emissiveIntensity = LAND_REST_EI;
            landMesh.material.emissive.setHex(COLOR_LAND);
            landSettled = true;
        }

        renderer.render(scene, camera);
    }

    // ---- public API used by game.js -------------------------------------

    const api = {
        init: init,

        isReady: function () { return ready; },

        /**
         * Map a game-space point (the same 800x600 coordinates the 2D game used)
         * to a pixel position on the overlay canvas. Phaser text/HUD effects use
         * this so they still line up with objects now drawn in perspective.
         */
        projectToScreen: function (gameX, gameY, height) {
            if (!ready) return { x: gameX, y: gameY };
            _proj.set(gameX, height === undefined ? LAND_H + TILE * 0.5 : height, gameY);
            _proj.project(camera);
            return {
                x: (_proj.x * 0.5 + 0.5) * BOARD_W,
                y: (-_proj.y * 0.5 + 0.5) * BOARD_H
            };
        },

        flash: function (durationMs, peak) {
            if (!ready) return;
            // Soft sheen by default (was a blinding 0.85 full-screen white).
            const top = peak !== undefined ? peak : 0.25;
            flashAlpha = top;
            flashDecay = top / Math.max(0.05, (durationMs || 500) / 1000);
            flashOverlay.material.opacity = flashAlpha;
            flashOverlay.visible = true;
        },

        shake: function (durationMs, intensity) {
            if (!ready) return;
            shakeDuration = Math.max(0.05, (durationMs || 100) / 1000);
            shakeTime = shakeDuration;
            shakeIntensity = (intensity || 0.01) * 2400;
        },

        /** Flare the captured land (brighten + shift toward lime) when territory
         *  is claimed, then it eases back to the resting emerald. */
        pulseLand: function (durationMs) {
            if (!ready) return;
            landPulseDuration = Math.max(0.05, (durationMs || 600) / 1000);
            landPulseTime = landPulseDuration;
        },

        /** Called on scene restart so capture animations replay for the new level. */
        reset: function () {
            if (!ready) return;
            resetAnim();
            lastDeadState = null;
            enemyMeshes.forEach(function (mesh) { scene.remove(mesh); });
            enemyMeshes.clear();
            powerupMeshes.forEach(function (mesh) { scene.remove(mesh); });
            powerupMeshes.clear();
            flashAlpha = 0;
            flashOverlay.visible = false;
            shakeTime = 0;
            landPulseTime = 0;
            landSettled = false;
            camera.position.copy(cameraBase);
            camera.lookAt(cameraTarget);
        }
    };

    window.Render3D = api;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
