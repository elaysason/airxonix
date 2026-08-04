const config = {
        type: Phaser.AUTO,
        width: 800,
        height: 600,
        // The 3D layer (render3d.js) draws the board, player, enemies and
        // powerups on a WebGL canvas underneath. Phaser keeps running the whole
        // simulation but renders only text/HUD effects, so its canvas is
        // transparent and parented into the same #stage box for 1:1 alignment.
        transparent: true,
        parent: 'stage',
        physics: {
            default: 'arcade',
            arcade: { gravity: { y: 0 }, debug: false }
        },
        scene: {
            preload: preload,
            create: create,
            update: update
        }
    };

// Convenience wrapper: map a game-space point to overlay-canvas pixels via the
// 3D camera. Falls back to identity if the 3D layer has not booted yet.
function to3DScreen(gameX, gameY, height) {
    if (window.Render3D && window.Render3D.isReady()) {
        return window.Render3D.projectToScreen(gameX, gameY, height);
    }
    return { x: gameX, y: gameY };
}
let powerupGroup;
let activePowerups = {
    shield: false,
    speed: false
};
const game = new Phaser.Game(config);

    // 2. GLOBAL VARIABLES
const TILE_SIZE = 20;
const COLS = 40; // 800 / 20
const ROWS = 30; // 600 / 20
let keyW, keyA, keyS, keyD; 
let level = 1;
let isGameOver = false;
let grid = [];      // 2D Array (Logic)
let landGroup;      // Physics Group (Visuals/Collision)
let player;
let cursors;             // Stores arrow key states
let currentDir = {x:0, y:0}; // Where we are moving NOW
let nextDir = {x:0, y:0};    // Where we WANT to move (Input Buffer)
let dirStack = [];           // Currently-held directions, in press order (last = most recent)
// Pixels per second. Movement used to be 4 pixels per rendered frame, making it
// visibly slower and input-laggier whenever the 3D renderer dipped below 60 FPS.
let PLAYER_SPEED = 240;
const BASE_PLAYER_SPEED = 240;
let ballSpeed = 150;        // Current enemy speed; (re)set per level in create()
let announcedEnemyTypes = new Set(); // Enemy types already introduced this level (once-per-type callout)
let trailStartLand = null;   // Land tile the current trail departed from (for out-and-back detection)
let isMoving = false;     
let targetPos = {x: 0, y: 0};
let enemyGroup;
let mainScene;
let screenTintShield, screenTintSpeed;
let cornerGlows = [];
let score = 0;
let totalTiles = (COLS-2) * (ROWS-2); // Total playable area (excluding borders)
let trailGroup;

// Cached DOM elements for performance
const domElements = {
    scoreText: null,
    percentText: null,
    objectiveProgress: null,
    levelText: null,
    gameOverScreen: null,
    levelUpScreen: null,
    startScreen: null,
    pauseScreen: null,
    finalScore: null,
    deathReason: null,
    bestScoreLine: null,
    startBest: null,
    levelScore: null,
    powerupSlot: null,
    powerupDivider: null,
    powerupLabel: null,
    powerupTimer: null
};

// Persistent high score (best score + highest level reached)
const HIGH_SCORE_KEY = 'airxonix_highscore';
let highScore = { score: 0, level: 1 };

function loadHighScore() {
    try {
        const raw = localStorage.getItem(HIGH_SCORE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            highScore = {
                score: Number(parsed.score) || 0,
                level: Number(parsed.level) || 1
            };
        }
    } catch (e) {
        highScore = { score: 0, level: 1 };
    }
    return highScore;
}

function saveHighScore() {
    try {
        localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(highScore));
    } catch (e) {
        // Storage unavailable (private mode / disabled) - fail silently.
    }
}

// Update best score/level from the current run. Returns true if a new record was set.
function recordHighScore(currentScore, currentLevel) {
    let improved = false;
    if (currentScore > highScore.score) { highScore.score = currentScore; improved = true; }
    if (currentLevel > highScore.level) { highScore.level = currentLevel; improved = true; }
    if (improved) saveHighScore();
    return improved;
}

function renderStartBest() {
    if (domElements.startBest) {
        domElements.startBest.innerText = `שיא: ${highScore.score} · שלב ${highScore.level}`;
    }
}

// Game state
let isPaused = false;
let gameStarted = false;
function preload () {
        // 1. NEON BLUE LAND (0x00f3ff)
        let g = this.make.graphics({x:0, y:0});
        g.fillStyle(0x00f3ff); 
        g.fillRect(0, 0, 20, 20);
        g.generateTexture('land', 20, 20);

        // 2. HOT PINK TRAIL (0xff00ff)
        let r = this.make.graphics({x:0, y:0});
        r.fillStyle(0xff00ff); 
        r.fillRect(0, 0, 20, 20);
        r.generateTexture('trail', 20, 20);

        // 3. GLOWING RED ENEMY (0xffaa00)
        let e = this.make.graphics({x:0, y:0});
        e.fillStyle(0xffaa00); 
        e.fillCircle(10, 10, 10);
        e.generateTexture('enemy', 20, 20);

        // 4. BRIGHT ORANGE DESTROYER (0xff3333)
        let d = this.make.graphics({x:0, y:0});
        d.fillStyle(0xff3333); 
        d.fillCircle(10, 10, 10);
        d.generateTexture('destroyer', 20, 20);

        // 5. HOMING ENEMY (Purple with eye) - follows player
        let h = this.make.graphics({x:0, y:0});
        h.fillStyle(0x9900ff, 1); 
        h.fillCircle(10, 10, 10);
        h.fillStyle(0xffffff, 1);
        h.fillCircle(13, 8, 3); // Eye
        h.fillStyle(0x000000, 1);
        h.fillCircle(14, 8, 1.5); // Pupil
        h.generateTexture('homing', 20, 20);

        // 6. FAST ENEMY (Cyan streak) - 2x speed
        let f = this.make.graphics({x:0, y:0});
        f.fillStyle(0x00ffff, 1);
        f.beginPath();
        f.moveTo(10, 2);
        f.lineTo(18, 10);
        f.lineTo(10, 18);
        f.lineTo(2, 10);
        f.closePath();
        f.fillPath();
        f.fillStyle(0xffffff, 0.8);
        f.fillCircle(10, 10, 4);
        f.generateTexture('fast', 20, 20);

        // 7. BOUNCER ENEMY (Green square) - erratic movement
        let b = this.make.graphics({x:0, y:0});
        b.fillStyle(0x00ff66, 1);
        b.fillRect(2, 2, 16, 16);
        b.fillStyle(0xffffff, 0.6);
        b.fillRect(5, 5, 4, 4);
        b.fillRect(11, 5, 4, 4);
        b.generateTexture('bouncer', 20, 20);
        
        // 5. WHITE PLAYER (0xffffff)
        let pG = this.make.graphics({x:0, y:0});

        // Draw a slightly darker outer glow
        pG.fillStyle(0xffff00, 0.5); 
        pG.fillRect(0, 0, 20, 20);

        // Draw the bright "Electric Lemon" core
        pG.fillStyle(0xedff21, 1); 
        pG.fillRect(2, 2, 16, 16); // Slightly smaller to create a border effect

        pG.generateTexture('player', 20, 20);
        let shp = this.make.graphics({x:0, y:0});
        shp.fillStyle(0x00ff00);
        shp.fillGradientStyle(0x00ff00, 0x00ff00, 0x004400, 0x004400);
        shp.fillCircle(10, 10, 8);
        shp.generateTexture('powerup_shield', 20, 20);

        // Cyan Bolt for Speed
        let spd = this.make.graphics({x:0, y:0});

        // Use a bright Magenta/Purple (0xff00ff)
        spd.fillStyle(0xff00ff, 1);
        // Draw a lightning bolt shape for "Speed"
        spd.beginPath();
        spd.moveTo(10, 2);  // Top
        spd.lineTo(4, 11);  // Middle Left
        spd.lineTo(9, 11);  // Middle Center
        spd.lineTo(7, 18);  // Bottom
        spd.lineTo(16, 8);  // Middle Right
        spd.lineTo(11, 8);  // Middle Center
        spd.closePath();
        spd.fillPath();

        spd.generateTexture('powerup_speed', 20, 20);
        
        // Shield glow (green) - larger circular texture for aura
        let gShield = this.make.graphics({x:0, y:0});
        gShield.fillStyle(0x00ff00, 0.35);
        gShield.fillCircle(20, 20, 18);
        gShield.generateTexture('glow_shield', 40, 40);

        // Speed glow (purple) - larger circular texture for aura
        let gSpeed = this.make.graphics({x:0, y:0});
        gSpeed.fillStyle(0xff00ff, 0.28);
        gSpeed.fillCircle(20, 20, 18);
        gSpeed.generateTexture('glow_speed', 40, 40);

        // Simple screen tint texture (for subtle overlay)
        let tintShield = this.make.graphics({x:0, y:0});
        tintShield.fillStyle(0x00ff00, 0.2);
        tintShield.fillRect(0, 0, 100, 100);
        tintShield.generateTexture('tint_shield', 100, 100);

        let tintSpeed = this.make.graphics({x:0, y:0});
        tintSpeed.fillStyle(0xff00ff, 0.18);
        tintSpeed.fillRect(0, 0, 100, 100);
        tintSpeed.generateTexture('tint_speed', 100, 100);

        // Corner glow indicator (small bright square)
        let cornerGlow = this.make.graphics({x:0, y:0});
        cornerGlow.fillStyle(0xffffff, 0.5);
        cornerGlow.fillRect(0, 0, 15, 15);
        cornerGlow.generateTexture('corner_glow', 15, 15);
            }

function create() {
    mainScene = this;
    
    // Cache DOM elements on first run
    if (!domElements.scoreText) {
        domElements.scoreText = document.getElementById('score-text');
        domElements.percentText = document.getElementById('percent-text');
        domElements.objectiveProgress = document.getElementById('objective-progress');
        domElements.levelText = document.getElementById('level-text');
        domElements.gameOverScreen = document.getElementById('game-over-screen');
        domElements.levelUpScreen = document.getElementById('level-up-screen');
        domElements.startScreen = document.getElementById('start-screen');
        domElements.pauseScreen = document.getElementById('pause-screen');
        domElements.finalScore = document.getElementById('final-score');
        domElements.deathReason = document.getElementById('death-reason');
        domElements.bestScoreLine = document.getElementById('best-score-line');
        domElements.startBest = document.getElementById('start-best');
        domElements.levelScore = document.getElementById('level-score');
        domElements.powerupSlot = document.getElementById('powerup-slot');
        domElements.powerupDivider = document.getElementById('powerup-divider');
        domElements.powerupLabel = document.getElementById('powerup-label');
        domElements.powerupTimer = document.getElementById('powerup-timer');
    }
    
    // Pause game until start button is clicked
    if (!gameStarted) {
        mainScene.physics.pause();
    }
    
    // 1. RESET ALL GAME VARIABLES (Fixes the "Ghost Player" bug)
    isGameOver = false;
    isPaused = false;
    isMoving = false;           
    targetPos = {x: 0, y: 0};   
    currentDir = {x:0, y:0};
    nextDir = {x:0, y:0};
    dirStack = [];
    PLAYER_SPEED = BASE_PLAYER_SPEED;
    // Powerups don't carry across levels/restarts. Scene shutdown cancels the
    // expiry timers, so without this the shield flag could stick = permanent invincibility.
    activePowerups = { shield: false, speed: false };
    // Re-teach enemy types each level: clear the "already introduced" set.
    announcedEnemyTypes = new Set();
    trailStartLand = null;
    // Only reset score if it's Level 1
    if (level === 1) score = 0;
    
    // Reset UI
    domElements.scoreText.innerText = score;
    domElements.percentText.innerText = "0";
    if (domElements.objectiveProgress) {
        domElements.objectiveProgress.style.width = '0%';
        domElements.objectiveProgress.classList.remove('on-fire');
    }
    if(domElements.levelText) {
        domElements.levelText.innerText = level;
    }
    // No powerup is active on a fresh level, so clear the HUD indicator.
    hidePowerupHud();

    // Drop 3D meshes belonging to the previous scene and replay capture pop-ups.
    if (window.Render3D) window.Render3D.reset();

    // 2. BUILD THE GRID
    for(let x=0; x<COLS; x++) {
        grid[x] = [];
        for(let y=0; y<ROWS; y++) {
            grid[x][y] = 0; 
        }
    }

    // 3. CREATE WALLS & TEXTURES
    landGroup = this.physics.add.staticGroup();

    for(let x=0; x<COLS; x++) {
        createLand(x, 0, this);       
        createLand(x, ROWS-1, this);  
    }
    for(let y=0; y<ROWS; y++) {
        createLand(0, y, this);       
        createLand(COLS-1, y, this);  
    }

    // Ensure player texture exists
    if (!this.textures.exists('player')) {
        let g = this.make.graphics({x:0, y:0});
        g.fillStyle(0xffff00);
        g.fillRect(0, 0, 20, 20);
        g.generateTexture('player', 20, 20);
    }

    // 4. SPAWN PLAYER FIRST (Critical for particles!)
    player = this.physics.add.sprite(0, 0, 'player');
    player.setOrigin(0);
    player.body.setSize(14, 14);
    player.body.setOffset(3, 3); // Center the 14x14 body within the 20x20 sprite
    player.setDepth(100);
    player.setVisible(false); // Drawn in 3D by render3d.js

// 5. ADD PARTICLES
    let particles = this.add.particles(0, 0, 'player', {
            speed: { min: 5, max: 15 },    // Slow, lingering trail
            scale: { start: 0.7, end: 0 }, // Slightly smaller than player
            lifespan: 400,
            alpha: { start: 0.5, end: 0 }, // Start semi-transparent
            tint: 0xedff21,                // FORCE the "Electric Lemon" color
            blendMode: 'NORMAL',           // 'NORMAL' keeps the yellow from turning white
            emitting: false                // See below: replaced by the 3D glow
        });

    particles.setDepth(50);
    particles.startFollow(player, 10, 10);
    // 2D particle trail is replaced by the player's 3D glow/point light.
    // setVisible(false) alone only stopped it being DRAWN — the emitter kept
    // spawning and simulating hundreds of particles per second for nothing, so
    // emission is switched off at the source.
    particles.setVisible(false);
    // 6. CONTROLS
    cursors = this.input.keyboard.createCursorKeys();
    keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    keyS = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    // Direction stack: newest pressed key wins, falls back to older still-held key on release
    dirStack = [];
    const bindDir = (key, dir) => {
        key.on('down', () => {
            // Remove any stale entry for this exact key, then push as most-recent
            dirStack = dirStack.filter(e => e.key !== key);
            dirStack.push({ key, dir });
            nextDir = dir;
        });
        key.on('up', () => {
            dirStack = dirStack.filter(e => e.key !== key);
            // Immediately fall back to the previous still-held key. When no key
            // remains, clear the request instead of replaying a stale direction.
            nextDir = dirStack.length > 0
                ? dirStack[dirStack.length - 1].dir
                : { x: 0, y: 0 };
        });
    };
    bindDir(cursors.left,  { x: -1, y: 0 });
    bindDir(keyA,          { x: -1, y: 0 });
    bindDir(cursors.right, { x: 1, y: 0 });
    bindDir(keyD,          { x: 1, y: 0 });
    bindDir(cursors.up,    { x: 0, y: -1 });
    bindDir(keyW,          { x: 0, y: -1 });
    bindDir(cursors.down,  { x: 0, y: 1 });
    bindDir(keyS,          { x: 0, y: 1 });
    
    // Pause key (ESC or P)
    this.input.keyboard.on('keydown-ESC', togglePause);
    this.input.keyboard.on('keydown-P', togglePause);
    
    this.input.keyboard.on('keydown-SPACE', handleGlobalInput);
    this.input.keyboard.on('keydown-ENTER', handleGlobalInput);

    // 7. ENEMIES & LOGIC
    enemyGroup = this.physics.add.group();
    trailGroup = this.add.group();

// REPLACE your old collider with this:
    this.physics.add.collider(enemyGroup, landGroup, (ball, block) => {

        // 1. SPLASH EFFECT
        // The 2D burst is invisible (it would not line up with the tilted 3D
        // board), and this collider fires many times per second per enemy, so
        // emitting here meant continuously simulating particles nobody sees.

        // 2. DESTROYER LOGIC (Only for Orange balls)
        if (ball.isDestroyer) {
            let bx = Math.floor(block.x / TILE_SIZE);
            let by = Math.floor(block.y / TILE_SIZE);

            if (bx > 0 && bx < COLS - 1 && by > 0 && by < ROWS - 1) {
                grid[bx][by] = 0; 
                score = Math.max(0, score - 10); 
                domElements.scoreText.innerText = score;
                updateGamePercentage();
                block.destroy();
                // ... (rest of your trail clearing logic) ...
            }
        }
    });
    // 8. LEVEL SCALING - Progressive enemy types
    ballSpeed = 150 + ((level - 1) * 15);
    let ballsToSpawn = Math.min(level + 1, 8); // Cap at 8 enemies

    for(let i=0; i < ballsToSpawn; i++) {
        let enemyType = getEnemyTypeForLevel(level, i);
        spawnEnemy(enemyType);
    }
    this.physics.world.on('worldbounds', (body) => {
        // Splash burst intentionally omitted: see the collider above.
    });
    // The player sprite itself is invisible (drawn in 3D), so the old infinite
    // alpha pulse tween on it was pure bookkeeping every frame.
    // Create full-screen tint overlays (will be faded in on powerup)
    screenTintShield = this.add.tileSprite(config.width / 2, config.height / 2, config.width, config.height, 'tint_shield');
    screenTintShield.setOrigin(0.5);
    screenTintShield.setDepth(399);
    screenTintShield.setBlendMode(Phaser.BlendModes.NORMAL);
    screenTintShield.setAlpha(0);
    screenTintShield.setScrollFactor(0);

    screenTintSpeed = this.add.tileSprite(config.width / 2, config.height / 2, config.width, config.height, 'tint_speed');
    screenTintSpeed.setOrigin(0.5);
    screenTintSpeed.setDepth(399);
    screenTintSpeed.setBlendMode(Phaser.BlendModes.NORMAL);
    screenTintSpeed.setAlpha(0);
    screenTintSpeed.setScrollFactor(0);

    // Create 4 corner glows (top-left, top-right, bottom-left, bottom-right)
    let corners = [
        { x: 8, y: 8 },
        { x: config.width - 8, y: 8 },
        { x: 8, y: config.height - 8 },
        { x: config.width - 8, y: config.height - 8 }
    ];
    corners.forEach(corner => {
        let c = this.add.sprite(corner.x, corner.y, 'corner_glow');
        c.setOrigin(0.5);
        c.setDepth(400);
        c.setAlpha(0);
        c.setScrollFactor(0);
        cornerGlows.push(c);
    });
    powerupGroup = this.physics.add.group();

    // Overlap check: When player touches a powerup
    this.physics.add.overlap(player, powerupGroup, (p, item) => {
        applyPowerup(item.texture.key);
        item.destroy();
    });

    // Spawn a powerup every 15 seconds
    this.time.addEvent({
        delay: 15000,
        callback: spawnPowerup,
        loop: true
    });
}
    // HELPER FUNCTION: Adds Land to both the Visuals and the Logic
    function createLand(x, y, scene) {
        if (grid[x][y] === 1) return; // Don't stack land on top of land
        
        // 1. Update Logic
        grid[x][y] = 1; 

        // 2. Update Visuals & Physics
        // We place it at x*20, y*20. origin(0) means top-left corner.
        let block = landGroup.create(x * TILE_SIZE, y * TILE_SIZE, 'land');
        block.setOrigin(0); 
        block.setVisible(false); // Drawn in 3D by render3d.js (physics body still used)
        block.refreshBody(); // Important for static physics bodies!
    }
// Precise check: does a circle at (sx, sy) with radius r overlap the tile (gx, gy)?
function tileOverlapsCircle(gx, gy, sx, sy, r) {
    const tx = gx * TILE_SIZE;
    const ty = gy * TILE_SIZE;
    const cx = Phaser.Math.Clamp(sx, tx, tx + TILE_SIZE);
    const cy = Phaser.Math.Clamp(sy, ty, ty + TILE_SIZE);
    return Phaser.Math.Distance.Between(sx, sy, cx, cy) <= r;
}

// Swept trail collision: sample the segment the ball traveled since the previous
// frame and kill the player if the ball's body touches any trail tile (grid 2).
function checkTrailSegment(ball, px, py, cx, cy) {
    if (activePowerups.shield) return false;
    const r = (ball.body && ball.body.radius) ? ball.body.radius : 10;
    const dist = Phaser.Math.Distance.Between(px, py, cx, cy);
    const steps = Math.max(1, Math.ceil(dist / 5)); // sample every 5px so consecutive circles overlap
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const sx = px + (cx - px) * t;
        const sy = py + (cy - py) * t;
        const minX = Math.floor((sx - r) / TILE_SIZE);
        const maxX = Math.floor((sx + r) / TILE_SIZE);
        const minY = Math.floor((sy - r) / TILE_SIZE);
        const maxY = Math.floor((sy + r) / TILE_SIZE);
        for (let gx = minX; gx <= maxX; gx++) {
            for (let gy = minY; gy <= maxY; gy++) {
                if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) continue;
                if (grid[gx][gy] === 2 && tileOverlapsCircle(gx, gy, sx, sy, r)) {
                    showGameOver('An enemy hit your trail. Reach land before they touch it.');
                    return true;
                }
            }
        }
    }
    return false;
}

function update(time, delta) {
    if (isGameOver || isPaused || !gameStarted) return;

    // 1. INPUT BUFFERING (Captures key presses anytime)
    // Most-recently-pressed direction still held wins (falls back to older held key)
    if (dirStack.length > 0) {
        nextDir = dirStack[dirStack.length - 1].dir;
    }

    // 2. MOVEMENT ENGINE (Runs every frame for smooth sliding)
    processMovement(delta);

    // 3. ENEMY LOGIC - Handle different enemy types
    enemyGroup.children.iterate((ball) => {
        if (!ball || !ball.active) return;
        
        let gx = Math.floor(ball.x / TILE_SIZE);
        let gy = Math.floor(ball.y / TILE_SIZE);

        // Trail Collision
        // Continuous (swept) check: fast enemies can cross a fresh trail entirely
        // within one frame, so we test the whole path swept since the previous
        // frame (using the ball's body radius) rather than just its center tile.
        if (ball.prevX !== undefined) {
            if (checkTrailSegment(ball, ball.prevX, ball.prevY, ball.x, ball.y)) return;
        }
        ball.prevX = ball.x;
        ball.prevY = ball.y;

        // Fallback: direct center-tile check (covers the first frame after spawn).
        if (grid[gx] && grid[gx][gy] === 2) {
            if (!activePowerups.shield) {
                showGameOver('אויב פגע בשובל שלכם. חזרו לשטח כבוש לפני שהם נוגעים בו.');
            }
            return;
        }
        
        // Player Collision (Reduced hitbox slightly for fairness)
        // Player has origin (0,0), so its center is offset by half a tile
        let playerCX = player.x + TILE_SIZE / 2;
        let playerCY = player.y + TILE_SIZE / 2;
        let dist = Phaser.Math.Distance.Between(ball.x, ball.y, playerCX, playerCY);
        if (dist < 15 && !activePowerups.shield) {
            showGameOver('אויב נגע בכם. הישארו על הגבול או שמרו מרחק.');
        }
        
        // Special enemy behaviors
        if (ball.enemyType === 'homing') {
            // Homing enemy slowly turns toward player
            let angle = Phaser.Math.Angle.Between(ball.x, ball.y, player.x, player.y);
            let currentAngle = Math.atan2(ball.body.velocity.y, ball.body.velocity.x);
            let newAngle = Phaser.Math.Angle.RotateTo(currentAngle, angle, 0.02);
            ball.setVelocity(
                Math.cos(newAngle) * ball.baseSpeed,
                Math.sin(newAngle) * ball.baseSpeed
            );
        }
        
        if (ball.enemyType === 'bouncer') {
            // Bouncer randomly changes direction
            ball.changeTimer += 1;
            if (ball.changeTimer > 60 + Math.random() * 60) {
                ball.changeTimer = 0;
                let newAngle = Math.random() * Math.PI * 2;
                ball.setVelocity(
                    Math.cos(newAngle) * ball.baseSpeed,
                    Math.sin(newAngle) * ball.baseSpeed
                );
            }
        }
    });
}

function processMovement(delta) {
    // Clamp long background-tab frames so returning to the game cannot skip
    // several grid cells. At normal frame rates this is 4px, matching the old
    // 60 FPS speed while remaining consistent when rendering is slower.
    const frameStep = PLAYER_SPEED * Math.min(delta, 34) / 1000;

    // --- STATE 1: SLIDING TOWARDS TARGET ---
    if (isMoving) {
        player.x = moveTowards(player.x, targetPos.x, frameStep);
        player.y = moveTowards(player.y, targetPos.y, frameStep);

        if (player.x === targetPos.x && player.y === targetPos.y) {
            isMoving = false;
        } else {
            return;
        }
        // Continue into STATE 2 immediately. Previously every tile arrival
        // burned a full frame before the queued turn could be processed.
    }

    // --- STATE 2: DECISION TIME ---
    let gridX = Math.round(player.x / TILE_SIZE);
    let gridY = Math.round(player.y / TILE_SIZE);
    let standingOnLand = (grid[gridX][gridY] === 1);

    // 1. Direction Logic
    if (nextDir.x !== 0 || nextDir.y !== 0) {
        if (standingOnLand) {
            currentDir = { ...nextDir }; 
        } else {
            let isReversalX = (nextDir.x !== 0 && nextDir.x === -currentDir.x);
            let isReversalY = (nextDir.y !== 0 && nextDir.y === -currentDir.y);
            if (isReversalX || isReversalY) {
                // Off-land, pressing the exact reverse direction stops the player
                // (pressing it must do something visible; and reversing would head
                // back over the trail we just drew). Walking into the trail is also
                // caught by the crash check below, so this stays safe either way.
                currentDir = { x: 0, y: 0 };
                return;
            }
            currentDir = { ...nextDir };
        }
    }

    if (currentDir.x === 0 && currentDir.y === 0) return;

    let nextX = gridX + currentDir.x;
    let nextY = gridY + currentDir.y;

    // 2. Boundary Check
    if (nextX < 0 || nextX >= COLS || nextY < 0 || nextY >= ROWS) {
        currentDir = {x:0, y:0}; 
        return;
    }

    // --- LOGIC & VISUALS ---
    let nextTileType = grid[nextX][nextY];

    // Crash Check: walking into our OWN trail is treated like a wall — stop
    // cleanly instead of dying. (Enemies hitting the trail still cause game
    // over; that check lives in the enemy loop.) This makes reversals safe.
    if (nextTileType === 2) {
        currentDir = { x: 0, y: 0 };
        return;
    }
    
    // LOOP CLOSING: If we hit land from a trail
    if (nextTileType === 1 && grid[gridX][gridY] === 2) {
        // Trivial out-and-back: a single-tile trail returning to the exact land
        // tile we departed from encloses nothing (e.g. up one tile then straight
        // back down). Cancel it — revert the lone trail tile, bank nothing.
        // (A 1-tile trail closing onto a DIFFERENT land tile can seal a real
        // pocket, so we only cancel the exact same-tile return.)
        if (trailStartLand && trailStartLand.x === nextX && trailStartLand.y === nextY
            && trailLength() <= 1) {
            grid[gridX][gridY] = 0;
            trailGroup.clear(true, true);
            // Snap the player back onto the departure land tile so they are never
            // left stranded on the now-empty tile (keeps the on-land invariant).
            player.x = nextX * TILE_SIZE;
            player.y = nextY * TILE_SIZE;
            targetPos = { x: player.x, y: player.y };
            isMoving = false;
            trailStartLand = null;
            currentDir = { x: 0, y: 0 };
            return;
        }
        triggerFill();
        trailStartLand = null;
    }

    // LOGIC: Mark the destination as dangerous IMMEDIATELY so you can't turn back
    if (nextTileType === 0) {
        // Record the land tile this trail departed from (first step off land).
        if (grid[gridX][gridY] === 1) {
            trailStartLand = { x: gridX, y: gridY };
        }
        grid[nextX][nextY] = 2; 
    }

    // VISUALS: Draw Red Square at CURRENT position (Underneath Player)
    // We only draw if we are currently standing on a "Trail" spot (2)
    // This reveals the red trail as you slide away from it
    if (grid[gridX][gridY] === 2) {
         let trail = mainScene.add.image(gridX * TILE_SIZE, gridY * TILE_SIZE, 'trail');
         trail.setOrigin(0);
         trail.setVisible(false); // Drawn in 3D from the grid by render3d.js
         trailGroup.add(trail);
    }

    // Start sliding
    targetPos = { x: nextX * TILE_SIZE, y: nextY * TILE_SIZE };
    isMoving = true;
}

// Count current trail tiles (grid value 2).
function trailLength() {
    let n = 0;
    for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < ROWS; y++) {
            if (grid[x][y] === 2) n++;
        }
    }
    return n;
}

// Seed the flood-fill "safe" map from a single enemy. Every LIVE enemy must
// contribute at least one seed, otherwise its region can be wrongly captured.
// Strategy: seed from every empty tile the enemy's body overlaps; if none of
// those are empty (enemy momentarily fully over land/border), BFS outward to the
// nearest empty tile and seed from that.
function seedEnemy(enemy, safeMap, stack) {
    if (!enemy || !enemy.active) return;
    const r = (enemy.body && enemy.body.radius) ? enemy.body.radius : 10;
    const cx = Math.floor(enemy.x / TILE_SIZE);
    const cy = Math.floor(enemy.y / TILE_SIZE);
    const minX = Math.floor((enemy.x - r) / TILE_SIZE);
    const maxX = Math.floor((enemy.x + r) / TILE_SIZE);
    const minY = Math.floor((enemy.y - r) / TILE_SIZE);
    const maxY = Math.floor((enemy.y + r) / TILE_SIZE);

    let seeded = false;
    for (let ex = minX; ex <= maxX; ex++) {
        for (let ey = minY; ey <= maxY; ey++) {
            if (ex >= 0 && ex < COLS && ey >= 0 && ey < ROWS &&
                grid[ex][ey] === 0 && !safeMap[ex][ey]) {
                safeMap[ex][ey] = true;
                stack.push({ x: ex, y: ey });
                seeded = true;
            }
        }
    }
    if (seeded) return;

    // Fallback: no empty tile in the body box. BFS outward from the enemy's
    // center tile to find the nearest empty tile and seed from it.
    const seen = new Set();
    const q = [{ x: cx, y: cy }];
    seen.add(cx + ',' + cy);
    while (q.length > 0) {
        const p = q.shift();
        if (p.x >= 0 && p.x < COLS && p.y >= 0 && p.y < ROWS &&
            grid[p.x][p.y] === 0) {
            if (!safeMap[p.x][p.y]) {
                safeMap[p.x][p.y] = true;
                stack.push({ x: p.x, y: p.y });
            }
            return;
        }
        for (const n of [{x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1}]) {
            const key = n.x + ',' + n.y;
            if (n.x >= 0 && n.x < COLS && n.y >= 0 && n.y < ROWS && !seen.has(key)) {
                seen.add(key);
                q.push(n);
            }
        }
    }
}

function triggerFill() {
    // 1. SOLIDIFY TRAIL: Turn Red (2) into Blue Land (1)
    for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < ROWS; y++) {
            if (grid[x][y] === 2) {
                createLand(x, y);
            }
        }
    }
    trailGroup.clear(true, true);
    // 2. PREPARE FOR FLOOD FILL: Create Safe Map
    let safeMap = [];
    for (let x = 0; x < COLS; x++) {
        safeMap[x] = [];
        for (let y = 0; y < ROWS; y++) {
            safeMap[x][y] = false;
        }
    }

    let stack = [];

    // 3. SEED FROM ENEMIES: every live enemy contributes at least one seed so
    // its region is never wrongly captured (see seedEnemy for the fallback).
    enemyGroup.children.iterate((enemy) => seedEnemy(enemy, safeMap, stack));

    // 4. EXECUTE FLOOD FILL
    while (stack.length > 0) {
        let p = stack.pop();
        let neighbors = [{x:p.x+1, y:p.y}, {x:p.x-1, y:p.y}, {x:p.x, y:p.y+1}, {x:p.x, y:p.y-1}];
        neighbors.forEach(n => {
            if (n.x >= 0 && n.x < COLS && n.y >= 0 && n.y < ROWS) {
                if (grid[n.x][n.y] === 0 && !safeMap[n.x][n.y]) {
                    safeMap[n.x][n.y] = true;
                    stack.push(n);
                }
            }
        });
    }

    // 5. THE REWARD: Fill Captured Void (0) that is NOT Safe
    let filledCount = 0;
    for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < ROWS; y++) {
            if (grid[x][y] === 0 && !safeMap[x][y]) {
                createLand(x, y);
                filledCount++;
            }
        }
    }
    
    // 6. UPDATE SCORE & PERCENTAGE
    score += filledCount * 10;
    // Flare the captured land on any successful capture (big captures also flash
    // + shake below). A larger fill flares a touch longer.
    if (filledCount > 0 && window.Render3D) {
        window.Render3D.pulseLand(filledCount > 20 ? 800 : 550);
    }
    if (filledCount > 20) {
        mainScene.cameras.main.shake(100, 0.01); // Tiny rumble
        // Phaser's camera only moves the 2D overlay, so drive the 3D camera too.
        // Soft, quick white sheen (the old Phaser full-white flash was removed;
        // its peak alpha can't be lowered, so it always read as a harsh blink).
        if (window.Render3D) {
            window.Render3D.flash(300, 0.25);
            window.Render3D.shake(100, 0.01);
        }
        igniteObjectiveBar(); // Objective bar briefly turns to fire
    }

    // Visual capture juice: floating score gain near the player, plus a
    // "BIG CAPTURE!" callout for large fills. No audio (air-gapped target).
    if (filledCount > 0) {
        showCaptureJuice(filledCount * 10, filledCount > 20);
    }
    let percent = updateGamePercentage();
    domElements.scoreText.innerText = score;
    domElements.percentText.innerText = percent;

    // 7. DESTROYER MILESTONE PROGRESSION
    let totalBalls = enemyGroup.getLength();
    let destroyersCount = 0;
    enemyGroup.children.iterate((ball) => {
        if (ball.isDestroyer) destroyersCount++;
    });

    // Milestone spawns - respect level progression for enemy types
    // Milestone 1: 20% -> Add enemy based on level
    if (percent >= 20 && totalBalls < 3) {
        ballSpeed += 15;
        if (level >= 5) spawnEnemy('bouncer');
        else if (level >= 4) spawnEnemy('homing');
        else if (level >= 3) spawnEnemy('destroyer');
        else if (level >= 2) spawnEnemy('fast');
        else spawnEnemy('normal');
    }
    
    // Milestone 2: 40% -> Add more enemies based on level
    if (percent >= 40 && totalBalls < 5) {
        ballSpeed += 15;
        if (level >= 3) {
            spawnEnemy('destroyer');
            if (level >= 4) spawnEnemy('homing');
        } else {
            spawnEnemy('fast');
            spawnEnemy('normal');
        }
    }

    // Milestone 3: 60% -> Add bouncer (only if level 5+)
    if (percent >= 60 && totalBalls < 7) {
        ballSpeed += 10 + 5 * (level - 1);
        if (level >= 5) {
            spawnEnemy('bouncer');
            spawnEnemy('homing');
        } else if (level >= 4) {
            spawnEnemy('homing');
            spawnEnemy('destroyer');
        } else if (level >= 3) {
            spawnEnemy('destroyer');
        } else if (level >= 2) {
            spawnEnemy('fast');
        } else {
            spawnEnemy('normal');
        }
    }

    // Sync all ball speeds (including existing ones) - but respect individual speeds
    enemyGroup.children.iterate((ball) => {
        if (!ball || !ball.active || !ball.baseSpeed) return;
        let v = ball.body.velocity;
        let angle = Math.atan2(v.y, v.x);
        // Scale speed based on enemy type
        let speedMultiplier = ball.baseSpeed / 150; // Relative to base ballSpeed
        ball.setVelocity(
            Math.cos(angle) * ballSpeed * speedMultiplier,
            Math.sin(angle) * ballSpeed * speedMultiplier
        );
    });

    // 8. WIN CONDITION
    if (percent >= 80) {
        // Pause the game so you don't die while celebrating
        mainScene.physics.pause();
        
        // Update level score display
        if (domElements.levelScore) {
            domElements.levelScore.innerText = score;
        }
        
        // Show the Green Popup
        domElements.levelUpScreen.style.display = 'block';
    }

}
    // Optional: Clear the Red Trail graphics (since they are now Blue Land)
    // You might need to restart the scene to clear the red squares cleanly, 
    // or just leave them covered by blue blocks.

// Briefly turn the objective bar into fire (used on a BIG CAPTURE), then revert.
function igniteObjectiveBar() {
    const bar = domElements.objectiveProgress;
    if (!bar) return;
    bar.classList.add('on-fire');
    if (igniteObjectiveBar._timer) clearTimeout(igniteObjectiveBar._timer);
    igniteObjectiveBar._timer = setTimeout(() => {
        bar.classList.remove('on-fire');
        igniteObjectiveBar._timer = null;
    }, 1200);
}

// Visual-only feedback for a successful capture. Shows a floating "+points"
// near the player and, for large captures, a "BIG CAPTURE!" callout.
function showCaptureJuice(points, isBig) {
    if (!mainScene || !player) return;

    // Anchor the popup over the player's projected 3D position, not its flat
    // grid coordinate, so the text sits on the player in the tilted view.
    let anchor = to3DScreen(player.x + TILE_SIZE / 2, player.y + TILE_SIZE / 2);
    let px = anchor.x;
    let py = anchor.y - 12;

    let gain = mainScene.add.text(px, py, `+${points}`, {
        fontSize: '18px',
        fontFamily: 'Arial',
        fontStyle: 'bold',
        color: '#00ff66',
        stroke: '#003311',
        strokeThickness: 3
    });
    gain.setOrigin(0.5, 1);
    gain.setDepth(300);
    mainScene.tweens.add({
        targets: gain,
        y: py - 40,
        alpha: 0,
        duration: 900,
        ease: 'Sine.easeOut',
        onComplete: () => gain.destroy()
    });

    if (isBig) {
        let phrase = BIG_CAPTURE_PHRASES[Math.floor(Math.random() * BIG_CAPTURE_PHRASES.length)];
        let big = mainScene.add.text(config.width / 2, config.height / 2, phrase, {
            fontSize: '40px',
            fontFamily: 'Arial',
            fontStyle: 'bold',
            color: '#ffffff',
            stroke: '#00aa44',
            strokeThickness: 6
        });
        big.setOrigin(0.5);
        big.setDepth(301);
        big.setScrollFactor(0);
        big.setScale(0.6);
        big.setAlpha(0);
        mainScene.tweens.add({
            targets: big,
            scale: 1,
            alpha: 1,
            duration: 250,
            ease: 'Back.easeOut',
            yoyo: true,
            hold: 500,
            onComplete: () => big.destroy()
        });
    }
}

// Funny Hebrew celebration lines shown on a big capture (picked at random).
const BIG_CAPTURE_PHRASES = [
    'אלוף העולם!',
    'וואו איזה כיבוש',
    'חיה רעה',
    'סחתן עליך',
    'מלך המסך',
    'כפרה עליך',
    'אין עליך בעולם',
    'תותח על',
    'לא יאומן כי יסופר',
    'נשק לא קונבנציונלי',
    'פשוט חיה'
];

// 1. CALL THIS WHEN YOU DIE
function showGameOver(reason = 'נתפסתם!') {
    if (isGameOver) return; // Guard against repeat calls within the same frame
    isGameOver = true; // <--- LOCK KEYS
    mainScene.physics.pause();
    player.setTint(0xff4500);

    // Update final score
    if (domElements.finalScore) {
        domElements.finalScore.innerText = score;
    }
    if (domElements.deathReason) {
        domElements.deathReason.innerText = reason;
    }

    // Persist and display best score/level
    const isNewRecord = recordHighScore(score, level);
    renderStartBest();
    if (domElements.bestScoreLine) {
        domElements.bestScoreLine.innerText = isNewRecord
            ? `שיא חדש! ${highScore.score} · שלב ${highScore.level}`
            : `שיא: ${highScore.score} · שלב ${highScore.level}`;
    }
    
    // Get the element
    let popup = domElements.gameOverScreen;
    
    // FORCE IT VISIBLE
    popup.style.display = 'block';
    popup.style.zIndex = "99999"; // Make sure it's on top of everything
    currentDir = {x:0, y:0};
    nextDir = {x:0, y:0};
    dirStack = [];
}

// Helper: Create a map of empty tiles that enemies can reach ("safe" empty tiles)
function generateSafeMap() {
    let safeMap = [];
    for (let x = 0; x < COLS; x++) {
        safeMap[x] = [];
        for (let y = 0; y < ROWS; y++) {
            safeMap[x][y] = false;
        }
    }

    let stack = [];

    // Seed from enemies (robust: every live enemy contributes a seed). Mirrors triggerFill.
    enemyGroup.children.iterate((enemy) => seedEnemy(enemy, safeMap, stack));

    // Flood-fill outward through empty tiles
    while (stack.length > 0) {
        let p = stack.pop();
        let neighbors = [{ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }];
        neighbors.forEach(n => {
            if (n.x >= 0 && n.x < COLS && n.y >= 0 && n.y < ROWS) {
                if (grid[n.x][n.y] === 0 && !safeMap[n.x][n.y]) {
                    safeMap[n.x][n.y] = true;
                    stack.push(n);
                }
            }
        });
    }

    return safeMap;
}

// 2. THE BUTTON CALLS THIS
function restartGame() {
    // Hide all popups
    domElements.gameOverScreen.style.display = 'none';
    domElements.pauseScreen.style.display = 'none';
    if (domElements.levelUpScreen) {
        domElements.levelUpScreen.style.display = 'none';
    }
    isPaused = false;
    isGameOver = false;

    // Restarting from a game-over or win screen should start a fresh run.
    level = 1;
    score = 0;
    
    // Restart the Phaser Scene
    mainScene.scene.restart();
}

// Toggle pause
function togglePause() {
    if (isGameOver || !gameStarted) return;
    
    isPaused = !isPaused;
    
    if (isPaused) {
        mainScene.physics.pause();
        domElements.pauseScreen.style.display = 'flex';
    } else {
        mainScene.physics.resume();
        domElements.pauseScreen.style.display = 'none';
    }
}

// Resume game from pause
function resumeGame() {
    if (!isPaused) return;
    isPaused = false;
    mainScene.physics.resume();
    domElements.pauseScreen.style.display = 'none';
}

// Start game from start screen
function startGame() {
    gameStarted = true;
    domElements.startScreen.style.display = 'none';
    if (mainScene) {
        mainScene.physics.resume();
    }
}

// Determine enemy type based on level and spawn index
function getEnemyTypeForLevel(lvl, index) {
    // Level 1: Only normal enemies
    if (lvl === 1) return 'normal';
    
    // Level 2: Mostly normal, one fast
    if (lvl === 2) {
        return index === 0 ? 'fast' : 'normal';
    }
    
    // Level 3: Introduce destroyer
    if (lvl === 3) {
        if (index === 0) return 'destroyer';
        if (index === 1) return 'fast';
        return 'normal';
    }
    
    // Level 4: Introduce homing
    if (lvl === 4) {
        if (index === 0) return 'homing';
        if (index === 1) return 'destroyer';
        if (index === 2) return 'fast';
        return 'normal';
    }
    
    // Level 5: Introduce bouncer
    if (lvl === 5) {
        if (index === 0) return 'bouncer';
        if (index === 1) return 'homing';
        if (index === 2) return 'destroyer';
        return index % 2 === 0 ? 'fast' : 'normal';
    }
    
    // Level 6+: Mix of all types, increasing difficulty
    const types = ['normal', 'fast', 'destroyer', 'homing', 'bouncer'];
    const weights = [
        Math.max(0, 5 - lvl),  // normal decreases
        Math.min(lvl, 3),      // fast increases
        Math.min(lvl - 2, 2),  // destroyer
        Math.min(lvl - 3, 2),  // homing
        Math.min(lvl - 4, 2)   // bouncer
    ];
    
    // Weighted random selection
    let totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    let cumulative = 0;
    
    for (let i = 0; i < types.length; i++) {
        cumulative += weights[i];
        if (random < cumulative) {
            return types[i];
        }
    }
    
    return 'normal';
}

// Enemy types: 'normal', 'destroyer', 'homing', 'fast', 'bouncer'
function spawnEnemy(enemyType = 'normal') {
    let rx, ry, gx, gy;
    let safeToSpawn = false;

    while (!safeToSpawn) {
        rx = Phaser.Math.Between(40, 760);
        ry = Phaser.Math.Between(40, 560);
        gx = Math.floor(rx / TILE_SIZE);
        gy = Math.floor(ry / TILE_SIZE);
        if (grid[gx][gy] === 0) safeToSpawn = true;
    }

    // Determine texture and properties based on type
    let texture, speed;
    
    switch(enemyType) {
        case 'destroyer':
            texture = 'destroyer';
            speed = ballSpeed;
            break;
        case 'homing':
            texture = 'homing';
            speed = ballSpeed * 0.6; // Slower but follows player
            break;
        case 'fast':
            texture = 'fast';
            speed = ballSpeed * 1.8; // Much faster
            break;
        case 'bouncer':
            texture = 'bouncer';
            speed = ballSpeed * 1.2;
            break;
        default:
            texture = 'enemy';
            speed = ballSpeed;
    }
    
    let ball = enemyGroup.create(rx, ry, texture);
    
    ball.setBounce(1);
    ball.setCollideWorldBounds(true);
    ball.body.onWorldBounds = true;
    ball.setCircle(10);
    ball.setDepth(50);
    ball.setVisible(false); // Drawn in 3D by render3d.js
    
    // Custom properties
    ball.enemyType = enemyType;
    ball.isDestroyer = (enemyType === 'destroyer');
    ball.baseSpeed = speed;
    ball.changeTimer = 0; // For bouncer

    let dirX = Math.random() > 0.5 ? speed : -speed;
    let dirY = Math.random() > 0.5 ? speed : -speed;
    ball.setVelocity(dirX, dirY);

    // Introduce each enemy type the first time it appears this level.
    announceEnemyType(enemyType, rx, ry);
}

// Enemy type introductions: label + one-line description + color.
const ENEMY_INFO = {
    normal:    { label: 'אויב',    desc: 'רגיל',            color: '#ffaa00' },
    fast:      { label: 'מהיר',    desc: 'מהירות פי 1.8',   color: '#00ffff' },
    destroyer: { label: 'הורס',    desc: 'מוחק שטח',        color: '#ff3333' },
    homing:    { label: 'נעול בפנים',  desc: 'עוקב אחריכם',     color: '#9900ff' },
    bouncer:   { label: 'מטורף',    desc: 'בלתי צפוי',       color: '#00ff66' }
};

// Show a brief callout the first time a given enemy type spawns in a level.
function announceEnemyType(enemyType, x, y) {
    if (!mainScene) return;
    if (announcedEnemyTypes.has(enemyType)) return;
    announcedEnemyTypes.add(enemyType);

    const info = ENEMY_INFO[enemyType] || ENEMY_INFO.normal;

    // Keep the label on-screen even when the enemy spawns near an edge.
    let scr = to3DScreen(x, y);
    let tx = Phaser.Math.Clamp(scr.x, 70, config.width - 70);
    let ty = Phaser.Math.Clamp(scr.y - 24, 20, config.height - 20);

    let msg = mainScene.add.text(tx, ty, `${info.label} — ${info.desc}`, {
        fontSize: '14px',
        fontFamily: 'Arial',
        fontStyle: 'bold',
        color: info.color,
        stroke: '#000000',
        strokeThickness: 4
    });
    msg.setOrigin(0.5);
    msg.setDepth(302);
    msg.setAlpha(0);

    mainScene.tweens.add({
        targets: msg,
        alpha: 1,
        y: ty - 12,
        duration: 300,
        ease: 'Sine.easeOut',
        hold: 1400,
        yoyo: true,
        onComplete: () => msg.destroy()
    });
}

function updateGamePercentage() {
    let currentLandCount = 0;
    // Loop through the inner grid
    for(let x=1; x<COLS-1; x++) {
        for(let y=1; y<ROWS-1; y++) {
            if (grid[x][y] === 1) currentLandCount++;
        }
    }

    let percent = Math.floor((currentLandCount / totalTiles) * 100);
    
    // Update the UI
    domElements.percentText.innerText = percent;
    if (domElements.objectiveProgress) {
        domElements.objectiveProgress.style.width = `${Math.min(percent, 80) / 80 * 100}%`;
    }
    
    return percent; // Return it so other functions can use it
}

function moveTowards(current, target, speed) {
    if (Math.abs(target - current) <= speed) {
        return target; // Snap to target if close enough
    }
    return current + Math.sign(target - current) * speed;
}

function nextLevel() {
    // 1. Hide the Popup
    domElements.levelUpScreen.style.display = 'none';

    // 2. Increase Level Counter
    level++;
    
    // 3. Restart the Scene (The 'create' function will handle the difficulty increase)
    mainScene.scene.restart();
}

function handleGlobalInput() {
    // 1. If "Game Over" screen is visible -> Restart Game
    if (domElements.gameOverScreen.style.display === 'block') {
        restartGame();
    }

    // 2. If "Level Complete" screen is visible -> Next Level
    // Note: We check if it is explicitly 'block' (visible)
    if (domElements.levelUpScreen && domElements.levelUpScreen.style.display === 'block') {
        nextLevel();
    }
}

function spawnPowerup() {
    // 1. Don't stack power-ups (Anti-camping)
    if (powerupGroup.countActive() > 0) return;

    let x, y, foundSpot = false;
    let attempts = 0;
    // Compute safe map: empty tiles that enemies can reach
    let safeMap = generateSafeMap();
    // Check if there is at least one safe empty tile available
    let hasSafeEmpty = false;
    for (let sx = 0; sx < COLS && !hasSafeEmpty; sx++) {
        for (let sy = 0; sy < ROWS; sy++) {
            if (safeMap[sx][sy]) { hasSafeEmpty = true; break; }
        }
    }

    while (!foundSpot && attempts < 100) {
        x = Phaser.Math.Between(5, COLS - 5);
        y = Phaser.Math.Between(5, ROWS - 5);
        // Only spawn far from player so they can't wait for it
        let dist = Phaser.Math.Distance.Between(x, y, player.x / TILE_SIZE, player.y / TILE_SIZE);

        // Preferred: empty tiles that are "safe" (reachable by enemies).
        if (hasSafeEmpty) {
            if (grid[x][y] === 0 && safeMap[x][y] && dist > 15) foundSpot = true;
        } else {
            // Fallback: if no safe empty tiles available, allow spawning on land
            if (grid[x][y] === 1 && dist > 15) foundSpot = true;
        }
        attempts++;
    }
    
    if (foundSpot) {
        let type = Math.random() > 0.5 ? 'powerup_shield' : 'powerup_speed';
        let p = powerupGroup.create(x * TILE_SIZE, y * TILE_SIZE, type);
        
        p.setOrigin(0);
        p.setDepth(200); // Forces it above everything
        p.setAlpha(1);   // Ensures it isn't transparent
        p.setVisible(false); // Drawn in 3D by render3d.js
        
        // Add a scale pulse so it doesn't look like a static "fake" block
        mainScene.tweens.add({
            targets: p,
            scale: 1.1,
            duration: 500,
            yoyo: true,
            repeat: -1
        });

        // Auto-despawn timer
        mainScene.time.delayedCall(8000, () => {
            if (p.active) p.destroy();
        });
    }
}
// Tear down all Shield powerup state/visuals. Idempotent + safe to call on re-pickup.
function clearShieldPowerup() {
    activePowerups.shield = false;
    if (player) { player.setAlpha(1); player.clearTint(); }
    if (activePowerups.shieldTimer) { activePowerups.shieldTimer.remove(false); delete activePowerups.shieldTimer; }
    if (activePowerups.shieldTween) { activePowerups.shieldTween.stop(); delete activePowerups.shieldTween; }
    if (activePowerups.shieldFollow) { mainScene.events.off('update', activePowerups.shieldFollow); delete activePowerups.shieldFollow; }
    if (activePowerups.shieldAura) { activePowerups.shieldAura.destroy(); delete activePowerups.shieldAura; }
    if (activePowerups.shieldUpdateBar) { mainScene.events.off('update', activePowerups.shieldUpdateBar); delete activePowerups.shieldUpdateBar; }
    if (activePowerups.shieldCornerTweens) { activePowerups.shieldCornerTweens.forEach(tw => tw.stop()); delete activePowerups.shieldCornerTweens; }
    mainScene.tweens.add({ targets: screenTintShield, alpha: 0, duration: 200 });
    cornerGlows.forEach(c => mainScene.tweens.add({ targets: c, alpha: 0, duration: 200 }));
    hidePowerupHud();
}

// Tear down all Speed powerup state/visuals. Idempotent + safe to call on re-pickup.
function clearSpeedPowerup() {
    activePowerups.speed = false;
    PLAYER_SPEED = BASE_PLAYER_SPEED;
    if (activePowerups.speedTimer) { activePowerups.speedTimer.remove(false); delete activePowerups.speedTimer; }
    if (activePowerups.speedTween) { activePowerups.speedTween.stop(); delete activePowerups.speedTween; }
    if (activePowerups.speedFollow) { mainScene.events.off('update', activePowerups.speedFollow); delete activePowerups.speedFollow; }
    if (activePowerups.speedAura) { activePowerups.speedAura.destroy(); delete activePowerups.speedAura; }
    if (activePowerups.speedUpdateBar) { mainScene.events.off('update', activePowerups.speedUpdateBar); delete activePowerups.speedUpdateBar; }
    if (activePowerups.speedCornerTweens) { activePowerups.speedCornerTweens.forEach(tw => tw.stop()); delete activePowerups.speedCornerTweens; }
    mainScene.tweens.add({ targets: screenTintSpeed, alpha: 0, duration: 200 });
    cornerGlows.forEach(c => mainScene.tweens.add({ targets: c, alpha: 0, duration: 200 }));
    hidePowerupHud();
}
const POWERUP_NAMES = {
    powerup_shield: 'מגן',
    powerup_speed: 'מהירות'
};

// The active-powerup indicator lives in the DOM HUD row (inside the frame), not
// on the Phaser overlay, so it never floats over the playfield. It shows the
// powerup name and a live seconds countdown, and hides when nothing is active.
function showPowerupHud(name, color) {
    if (!domElements.powerupSlot) return;
    domElements.powerupLabel.innerText = name;
    domElements.powerupLabel.style.color = color;
    domElements.powerupTimer.style.color = color;
    domElements.powerupDivider.style.display = '';
    domElements.powerupSlot.style.display = '';
}

function setPowerupTimer(seconds, color) {
    if (!domElements.powerupTimer) return;
    domElements.powerupTimer.innerText = seconds;
    domElements.powerupTimer.style.color = color;
}

function hidePowerupHud() {
    if (!domElements.powerupSlot) return;
    domElements.powerupSlot.style.display = 'none';
    domElements.powerupDivider.style.display = 'none';
}

function applyPowerup(key) {
    let pickAnchor = to3DScreen(player.x + TILE_SIZE / 2, player.y + TILE_SIZE / 2);
    let msg = mainScene.add.text(pickAnchor.x, pickAnchor.y - 20, POWERUP_NAMES[key] || key, {
        fontSize: '16px',
        fill: '#fff',
        fontWeight: 'bold'
    });
    
    // Float up and fade out
    mainScene.tweens.add({
        targets: msg,
        y: '-=50',
        alpha: 0,
        duration: 1000,
        onComplete: () => msg.destroy()
    });
    if (key === 'powerup_shield') {
        // Refresh if already active: tear down prior instance so timers/auras don't stack/leak
        if (activePowerups.shield) clearShieldPowerup();
        activePowerups.shield = true;
        player.setAlpha(0.5); // Visual feedback
        player.setTint(0x00ff00);

        // Add a green aura image that follows the player (safer than emitter APIs)
        let shieldAnchor = to3DScreen(player.x + TILE_SIZE / 2, player.y + TILE_SIZE / 2);
        let shieldAura = mainScene.add.image(shieldAnchor.x, shieldAnchor.y, 'glow_shield');
        shieldAura.setOrigin(0.5);
        shieldAura.setDepth(90);
        shieldAura.setBlendMode(Phaser.BlendModes.ADD);
        shieldAura.setAlpha(0.75);
        shieldAura.setScale(0.7);

        // Tween pulse
        let shieldTween = mainScene.tweens.add({
            targets: shieldAura,
            scale: 1.05,
            duration: 600,
            yoyo: true,
            repeat: -1
        });

        // Follow on each frame (tracks the player's projected 3D position)
        let shieldFollow = () => {
            if (shieldAura && player) {
                let a = to3DScreen(player.x + TILE_SIZE / 2, player.y + TILE_SIZE / 2);
                shieldAura.x = a.x;
                shieldAura.y = a.y;
            }
        };
        mainScene.events.on('update', shieldFollow);
        activePowerups.shieldAura = shieldAura;
        activePowerups.shieldFollow = shieldFollow;
        activePowerups.shieldTween = shieldTween;
        // Store powerup start time for countdown
        activePowerups.shieldStartTime = mainScene.time.now;
        activePowerups.shieldDuration = 5000;
        
        // Fade in screen tint
        mainScene.tweens.add({ targets: screenTintShield, alpha: 0.15, duration: 200 });
        
        // Show and pulse corner glows
        cornerGlows.forEach(c => {
            c.setTint(0x00ff00);
            let tw = mainScene.tweens.add({ targets: c, alpha: { from: 0.3, to: 0.8 }, duration: 500, yoyo: true, repeat: -1 });
            if (!activePowerups.shieldCornerTweens) activePowerups.shieldCornerTweens = [];
            activePowerups.shieldCornerTweens.push(tw);
        });
        
        // Show the powerup indicator in the HUD frame (throb is CSS-driven).
        showPowerupHud('מגן', '#00ff94');

        // Update the countdown each frame
        activePowerups.shieldUpdateBar = () => {
            let elapsed = mainScene.time.now - activePowerups.shieldStartTime;
            let remaining = Math.max(0, activePowerups.shieldDuration - elapsed);
            let percent = remaining / activePowerups.shieldDuration;

            setPowerupTimer(Math.ceil(remaining / 1000), percent > 0.2 ? '#00ff94' : '#ff6600');
        };
        mainScene.events.on('update', activePowerups.shieldUpdateBar);

        activePowerups.shieldTimer = mainScene.time.delayedCall(5000, clearShieldPowerup);
    } 
    else if (key === 'powerup_speed') {
        // Refresh if already active: tear down prior instance so timers/auras don't stack/leak
        if (activePowerups.speed) clearSpeedPowerup();
        activePowerups.speed = true;
        // Double PLAYER_SPEED (always relative to the base, never a previously-boosted value)
        PLAYER_SPEED = BASE_PLAYER_SPEED * 2; 

        // Add a purple aura image that follows the player
        let speedAnchor = to3DScreen(player.x + TILE_SIZE / 2, player.y + TILE_SIZE / 2);
        let speedAura = mainScene.add.image(speedAnchor.x, speedAnchor.y, 'glow_speed');
        speedAura.setOrigin(0.5);
        speedAura.setDepth(90);
        speedAura.setBlendMode(Phaser.BlendModes.ADD);
        speedAura.setAlpha(0.7);
        speedAura.setScale(0.75);

        // Tween pulse
        let speedTween = mainScene.tweens.add({
            targets: speedAura,
            scale: 1.08,
            duration: 500,
            yoyo: true,
            repeat: -1
        });

        // Follow on each frame (tracks the player's projected 3D position)
        let speedFollow = () => {
            if (speedAura && player) {
                let a = to3DScreen(player.x + TILE_SIZE / 2, player.y + TILE_SIZE / 2);
                speedAura.x = a.x;
                speedAura.y = a.y;
            }
        };
        mainScene.events.on('update', speedFollow);
        activePowerups.speedAura = speedAura;
        activePowerups.speedFollow = speedFollow;
        activePowerups.speedTween = speedTween;
        // Store powerup start time for countdown
        activePowerups.speedStartTime = mainScene.time.now;
        activePowerups.speedDuration = 7000;
        
        // Fade in screen tint
        mainScene.tweens.add({ targets: screenTintSpeed, alpha: 0.13, duration: 200 });
        
        // Show and pulse corner glows
        cornerGlows.forEach(c => {
            c.setTint(0xff00ff);
            let tw = mainScene.tweens.add({ targets: c, alpha: { from: 0.35, to: 0.85 }, duration: 450, yoyo: true, repeat: -1 });
            if (!activePowerups.speedCornerTweens) activePowerups.speedCornerTweens = [];
            activePowerups.speedCornerTweens.push(tw);
        });
        
        // Show the powerup indicator in the HUD frame (throb is CSS-driven).
        showPowerupHud('מהירות', '#ff00ff');

        // Update the countdown each frame
        activePowerups.speedUpdateBar = () => {
            let elapsed = mainScene.time.now - activePowerups.speedStartTime;
            let remaining = Math.max(0, activePowerups.speedDuration - elapsed);
            let percent = remaining / activePowerups.speedDuration;

            setPowerupTimer(Math.ceil(remaining / 1000), percent > 0.2 ? '#ff00ff' : '#ffaa00');
        };
        mainScene.events.on('update', activePowerups.speedUpdateBar);

        activePowerups.speedTimer = mainScene.time.delayedCall(7000, clearSpeedPowerup);
    }
}

// Initialize start button when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    loadHighScore();
    domElements.startBest = document.getElementById('start-best');
    renderStartBest();
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
        startBtn.addEventListener('click', startGame);
    }
});
