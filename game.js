const config = {
        type: Phaser.AUTO,
        width: 800,
        height: 600,
        backgroundColor: '#000000',
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
let PLAYER_SPEED = 4;       // Speed: 4 = Normal, 8 = Fast
const BASE_PLAYER_SPEED = 4; // Default speed to restore to when Speed powerup ends
let isMoving = false;     
let targetPos = {x: 0, y: 0};
let enemyGroup;
let mainScene;
let shieldEdge, speedEdge;
let screenTintShield, screenTintSpeed;
let powerupHudBg, powerupHudBar, powerupTimerText;
let cornerGlows = [];
let score = 0;
let totalTiles = (COLS-2) * (ROWS-2); // Total playable area (excluding borders)
let filledTiles = 0;
let trailGroup;

// Cached DOM elements for performance
const domElements = {
    scoreText: null,
    percentText: null,
    levelText: null,
    gameOverScreen: null,
    levelUpScreen: null,
    startScreen: null,
    pauseScreen: null,
    finalScore: null,
    levelScore: null
};

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

        // Edge tile textures (small repeating tiles for animated borders)
        let tShield = this.make.graphics({x:0, y:0});
        tShield.fillStyle(0x00ff00, 0.5);
        tShield.fillRect(0, 0, 20, 20);
        tShield.generateTexture('edge_tile_shield', 20, 20);

        let tSpeed = this.make.graphics({x:0, y:0});
        tSpeed.fillStyle(0xff00ff, 0.45);
        tSpeed.fillRect(0, 0, 20, 20);
        tSpeed.generateTexture('edge_tile_speed', 20, 20);

        // Create a soft blur texture by drawing concentric circles
        let blurShield = this.make.graphics({x:0, y:0});
        for (let i = 12; i >= 2; i -= 2) {
            blurShield.fillStyle(0x00ff00, 0.06 + (i / 50));
            blurShield.fillCircle(30, 30, i + 6);
        }
        blurShield.generateTexture('edge_blur_shield', 60, 60);

        let blurSpeed = this.make.graphics({x:0, y:0});
        for (let i = 12; i >= 2; i -= 2) {
            blurSpeed.fillStyle(0xff00ff, 0.05 + (i / 60));
            blurSpeed.fillCircle(30, 30, i + 6);
        }
        blurSpeed.generateTexture('edge_blur_speed', 60, 60);

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
        domElements.levelText = document.getElementById('level-text');
        domElements.gameOverScreen = document.getElementById('game-over-screen');
        domElements.levelUpScreen = document.getElementById('level-up-screen');
        domElements.startScreen = document.getElementById('start-screen');
        domElements.pauseScreen = document.getElementById('pause-screen');
        domElements.finalScore = document.getElementById('final-score');
        domElements.levelScore = document.getElementById('level-score');
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
    // Only reset score if it's Level 1
    if (level === 1) score = 0;
    
    // Reset UI
    domElements.scoreText.innerText = score;
    domElements.percentText.innerText = "0";
    if(domElements.levelText) {
        domElements.levelText.innerText = level;
    }

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

// 5. ADD PARTICLES
    let particles = this.add.particles(0, 0, 'player', {
            speed: { min: 5, max: 15 },    // Slow, lingering trail
            scale: { start: 0.7, end: 0 }, // Slightly smaller than player
            lifespan: 400,
            alpha: { start: 0.5, end: 0 }, // Start semi-transparent
            tint: 0xedff21,                // FORCE the "Electric Lemon" color
            blendMode: 'NORMAL'            // 'NORMAL' keeps the yellow from turning white
        });
    
    particles.setDepth(50); 
    particles.startFollow(player, 10, 10);
    let s = this.make.graphics({x:0, y:0});
    s.fillStyle(0xffffff); // White
    s.fillCircle(2, 2, 2); // Tiny dot
    s.generateTexture('splash', 4, 4);
    // FIX: Set Depth to 50 so it renders ABOVE the red trail (Depth 0)
    
    let splashEmitter = this.add.particles(0, 0, 'splash', {
        speed: { min: 50, max: 150 }, // Fast burst
        scale: { start: 1, end: 0 },  // Shrink to nothing
        lifespan: 300,                // Short life
        blendMode: 'ADD',             // Glowing effect
        emitting: false               // Don't fire yet!
    });
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
        });
        key.on('up', () => {
            dirStack = dirStack.filter(e => e.key !== key);
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
        
        // 1. SPLASH EFFECT (For ALL balls)
        splashEmitter.explode(10, ball.x, ball.y); // Burst 10 particles

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
        // Trigger the same splash at the ball's position
        splashEmitter.explode(10, body.x, body.y);
    });
    mainScene.tweens.add({
    targets: player,
    alpha: 0.7,
    duration: 800,
    ease: 'Sine.easeInOut',
    yoyo: true,
    repeat: -1
});
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

    // Create dark HUD background panel (behind bar and text)
    powerupHudBg = this.add.graphics();
    powerupHudBg.fillStyle(0x000000, 0.7);
    powerupHudBg.fillRect(config.width / 2 - 100, 2, 200, 30);
    powerupHudBg.setDepth(399);
    powerupHudBg.setScrollFactor(0);
    powerupHudBg.setVisible(false);

    // Create timer text
    powerupTimerText = this.add.text(config.width / 2, 15, '', {
        fontSize: '14px',
        fill: '#fff',
        fontFamily: 'Arial',
        align: 'center'
    });
    powerupTimerText.setOrigin(0.5);
    powerupTimerText.setDepth(401);
    powerupTimerText.setScrollFactor(0);
    powerupTimerText.setVisible(false);

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
        block.refreshBody(); // Important for static physics bodies!
    }
function update(time, delta) {
    if (isGameOver || isPaused || !gameStarted) return;

    // 1. INPUT BUFFERING (Captures key presses anytime)
    // Most-recently-pressed direction still held wins (falls back to older held key)
    if (dirStack.length > 0) {
        nextDir = dirStack[dirStack.length - 1].dir;
    }

    // 2. MOVEMENT ENGINE (Runs every frame for smooth sliding)
    processMovement();

    // 3. ENEMY LOGIC - Handle different enemy types
    enemyGroup.children.iterate((ball) => {
        if (!ball || !ball.active) return;
        
        let gx = Math.floor(ball.x / TILE_SIZE);
        let gy = Math.floor(ball.y / TILE_SIZE);

        // Trail Collision
        if (grid[gx] && grid[gx][gy] === 2) {
            if (!activePowerups.shield) {
                showGameOver();
            }
        }
        
        // Player Collision (Reduced hitbox slightly for fairness)
        // Player has origin (0,0), so its center is offset by half a tile
        let playerCX = player.x + TILE_SIZE / 2;
        let playerCY = player.y + TILE_SIZE / 2;
        let dist = Phaser.Math.Distance.Between(ball.x, ball.y, playerCX, playerCY);
        if (dist < 15 && !activePowerups.shield) {
            showGameOver();
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

function processMovement() {
    // --- STATE 1: SLIDING TOWARDS TARGET ---
    if (isMoving) {
        player.x = moveTowards(player.x, targetPos.x, PLAYER_SPEED);
        player.y = moveTowards(player.y, targetPos.y, PLAYER_SPEED);

        if (player.x === targetPos.x && player.y === targetPos.y) {
            isMoving = false;
        }
        return; 
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
            if (!isReversalX && !isReversalY) currentDir = { ...nextDir };
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

    // Crash Check
    if (nextTileType === 2) {
        if (!activePowerups.shield) {
            showGameOver();
        } else {
            // Shielded: don't die to our own trail, but never cross it.
            // Stop cleanly so the player can steer away instead of soft-locking.
            currentDir = {x:0, y:0};
        }
        return;
    }
    
    // LOOP CLOSING: If we hit land from a trail
    if (nextTileType === 1 && grid[gridX][gridY] === 2) {
        triggerFill();
    }

    // LOGIC: Mark the destination as dangerous IMMEDIATELY so you can't turn back
    if (nextTileType === 0) {
        grid[nextX][nextY] = 2; 
    }

    // VISUALS: Draw Red Square at CURRENT position (Underneath Player)
    // We only draw if we are currently standing on a "Trail" spot (2)
    // This reveals the red trail as you slide away from it
    if (grid[gridX][gridY] === 2) {
         let trail = mainScene.add.image(gridX * TILE_SIZE, gridY * TILE_SIZE, 'trail');
         trail.setOrigin(0);
         trailGroup.add(trail);
    }

    // Start sliding
    targetPos = { x: nextX * TILE_SIZE, y: nextY * TILE_SIZE };
    isMoving = true;
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

    // 3. SEED FROM ENEMIES: Mark areas enemies can reach as "Safe"
    enemyGroup.children.iterate((enemy) => {
        let ex = Math.floor(enemy.x / TILE_SIZE);
        let ey = Math.floor(enemy.y / TILE_SIZE);
        if (grid[ex][ey] === 0) {
            stack.push({ x: ex, y: ey });
            safeMap[ex][ey] = true;
        }
    });

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
    let currentLandCount = 0;
    for (let x = 1; x < COLS - 1; x++) {
        for (let y = 1; y < ROWS - 1; y++) {
            if (grid[x][y] === 1) currentLandCount++;
        }
    }
    if (filledCount > 20) {
        mainScene.cameras.main.flash(500); // White flash for 0.5s
        mainScene.cameras.main.shake(100, 0.01); // Tiny rumble
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


// 1. CALL THIS WHEN YOU DIE
function showGameOver() {
    if (isGameOver) return; // Guard against repeat calls within the same frame
    isGameOver = true; // <--- LOCK KEYS
    mainScene.physics.pause();
    player.setTint(0xff4500);

    // Update final score
    if (domElements.finalScore) {
        domElements.finalScore.innerText = score;
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

    // Seed from enemies' current positions
    enemyGroup.children.iterate((enemy) => {
        let ex = Math.floor(enemy.x / TILE_SIZE);
        let ey = Math.floor(enemy.y / TILE_SIZE);
        if (ex >= 0 && ex < COLS && ey >= 0 && ey < ROWS) {
            if (grid[ex][ey] === 0 && !safeMap[ex][ey]) {
                safeMap[ex][ey] = true;
                stack.push({ x: ex, y: ey });
            }
        }
    });

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

function levelComplete() {
    isGameOver = true; 
    mainScene.physics.pause();
    
    // Create a "You Win" popup (or reuse the Game Over one with different text)
    let popup = domElements.gameOverScreen;
    popup.querySelector('h1').innerText = "LEVEL COMPLETE!";
    popup.querySelector('button').innerText = "Play Again";
    popup.querySelector('button').style.background = '#00ff00';
    popup.style.display = 'block';
    popup.style.background = '#006600';     // Dark Green Background
    popup.style.borderColor = '#00ff00';    // Bright Green Border
    
    popup.querySelector('button').background = '#00ff00';    // Bright Green Button
    popup.querySelector('button').color = 'black';
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
    let texture, speed, behavior;
    
    switch(enemyType) {
        case 'destroyer':
            texture = 'destroyer';
            speed = ballSpeed;
            behavior = 'destroyer';
            break;
        case 'homing':
            texture = 'homing';
            speed = ballSpeed * 0.6; // Slower but follows player
            behavior = 'homing';
            break;
        case 'fast':
            texture = 'fast';
            speed = ballSpeed * 1.8; // Much faster
            behavior = 'fast';
            break;
        case 'bouncer':
            texture = 'bouncer';
            speed = ballSpeed * 1.2;
            behavior = 'bouncer';
            break;
        default:
            texture = 'enemy';
            speed = ballSpeed;
            behavior = 'normal';
    }
    
    let ball = enemyGroup.create(rx, ry, texture);
    
    ball.setBounce(1);
    ball.setCollideWorldBounds(true);
    ball.body.onWorldBounds = true;
    ball.setCircle(10);
    ball.setDepth(50);
    
    // Custom properties
    ball.enemyType = enemyType;
    ball.isDestroyer = (enemyType === 'destroyer');
    ball.baseSpeed = speed;
    ball.changeTimer = 0; // For bouncer

    let dirX = Math.random() > 0.5 ? speed : -speed;
    let dirY = Math.random() > 0.5 ? speed : -speed;
    ball.setVelocity(dirX, dirY);
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
    if (activePowerups.shieldTimerTween) { activePowerups.shieldTimerTween.stop(); delete activePowerups.shieldTimerTween; }
    if (activePowerups.shieldCornerTweens) { activePowerups.shieldCornerTweens.forEach(tw => tw.stop()); delete activePowerups.shieldCornerTweens; }
    if (powerupTimerText) powerupTimerText.setScale(1);
    mainScene.tweens.add({ targets: screenTintShield, alpha: 0, duration: 200 });
    cornerGlows.forEach(c => mainScene.tweens.add({ targets: c, alpha: 0, duration: 200 }));
    if (powerupHudBg) powerupHudBg.setVisible(false);
    if (powerupHudBar) powerupHudBar.setVisible(false);
    if (powerupTimerText) powerupTimerText.setVisible(false);
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
    if (activePowerups.speedTimerTween) { activePowerups.speedTimerTween.stop(); delete activePowerups.speedTimerTween; }
    if (activePowerups.speedCornerTweens) { activePowerups.speedCornerTweens.forEach(tw => tw.stop()); delete activePowerups.speedCornerTweens; }
    if (powerupTimerText) powerupTimerText.setScale(1);
    mainScene.tweens.add({ targets: screenTintSpeed, alpha: 0, duration: 200 });
    cornerGlows.forEach(c => mainScene.tweens.add({ targets: c, alpha: 0, duration: 200 }));
    if (powerupHudBg) powerupHudBg.setVisible(false);
    if (powerupHudBar) powerupHudBar.setVisible(false);
    if (powerupTimerText) powerupTimerText.setVisible(false);
}
function applyPowerup(key) {
    let msg = mainScene.add.text(player.x, player.y - 20, key.split('_')[1].toUpperCase(), {
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
        let shieldAura = mainScene.add.image(player.x + 10, player.y + 10, 'glow_shield');
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

        // Follow on each frame
        let shieldFollow = () => {
            if (shieldAura && player) {
                shieldAura.x = player.x + 10;
                shieldAura.y = player.y + 10;
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
        
        // Show HUD bar and pulse
        if (powerupHudBg) powerupHudBg.setVisible(true);
        if (powerupHudBar) powerupHudBar.setVisible(true);
        if (powerupTimerText) powerupTimerText.setVisible(true);
        let timerTween = mainScene.tweens.add({ targets: powerupTimerText, scale: { from: 1, to: 1.05 }, duration: 400, yoyo: true, repeat: -1 });
        activePowerups.shieldTimerTween = timerTween;
        
        // Update bar each frame
        activePowerups.shieldUpdateBar = () => {
            let elapsed = mainScene.time.now - activePowerups.shieldStartTime;
            let remaining = Math.max(0, activePowerups.shieldDuration - elapsed);
            let percent = remaining / activePowerups.shieldDuration;
            
            if (powerupHudBar) {
                powerupHudBar.clear();
                powerupHudBar.lineStyle(2, 0x00ff00, 1);
                powerupHudBar.strokeRect(config.width / 2 - 80, 8, 160, 14);
                powerupHudBar.fillStyle(0x00ff00, 0.6);
                powerupHudBar.fillRect(config.width / 2 - 78, 10, 156 * percent, 10);
            }
            
            if (powerupTimerText) {
                powerupTimerText.setText(`SHIELD ${Math.ceil(remaining / 1000)}s`);
                powerupTimerText.setColor(percent > 0.2 ? '#00ff00' : '#ff6600');
            }
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
        let speedAura = mainScene.add.image(player.x + 10, player.y + 10, 'glow_speed');
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

        // Follow on each frame
        let speedFollow = () => {
            if (speedAura && player) {
                speedAura.x = player.x + 10;
                speedAura.y = player.y + 10;
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
        
        // Show HUD bar and pulse
        if (powerupHudBg) powerupHudBg.setVisible(true);
        if (powerupHudBar) powerupHudBar.setVisible(true);
        if (powerupTimerText) powerupTimerText.setVisible(true);
        let timerTween = mainScene.tweens.add({ targets: powerupTimerText, scale: { from: 1, to: 1.05 }, duration: 380, yoyo: true, repeat: -1 });
        activePowerups.speedTimerTween = timerTween;
        
        // Update bar each frame
        activePowerups.speedUpdateBar = () => {
            let elapsed = mainScene.time.now - activePowerups.speedStartTime;
            let remaining = Math.max(0, activePowerups.speedDuration - elapsed);
            let percent = remaining / activePowerups.speedDuration;
            
            if (powerupHudBar) {
                powerupHudBar.clear();
                powerupHudBar.lineStyle(2, 0xff00ff, 1);
                powerupHudBar.strokeRect(config.width / 2 - 80, 8, 160, 14);
                powerupHudBar.fillStyle(0xff00ff, 0.6);
                powerupHudBar.fillRect(config.width / 2 - 78, 10, 156 * percent, 10);
            }
            
            if (powerupTimerText) {
                powerupTimerText.setText(`SPEED ${Math.ceil(remaining / 1000)}s`);
                powerupTimerText.setColor(percent > 0.2 ? '#ff00ff' : '#ffaa00');
            }
        };
        mainScene.events.on('update', activePowerups.speedUpdateBar);

        activePowerups.speedTimer = mainScene.time.delayedCall(7000, clearSpeedPowerup);
    }
}

// Initialize start button when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
        startBtn.addEventListener('click', startGame);
    }
});
