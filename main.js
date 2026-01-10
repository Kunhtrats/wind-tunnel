import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- CONFIGURATION ---
const CONFIG = {
    particleCount: 8000,
    // We store km/h directly now, but convert to internal units for physics
    windKmh: 100.0, 
    domainSize: { x: 30, y: 15, z: 15 }, 
    autoRotate: false,
    pause: false
};

// --- GLOBAL VARIABLES ---
let scene, camera, renderer, controls;
let particlesMesh;
let dummy = new THREE.Object3D(); 
let particleData = []; 
let obstacleMesh;
let currentShapeType = 'wing';

const container = document.getElementById('canvas-container');

// Map km/h to simulation speed (approx 0.1 to 3.0 internal units)
const kmhToSim = (kmh) => Math.max(0.1, kmh / 60.0);

init();
animate();

function init() {
    // 1. Setup Scene
    scene = new THREE.Scene();
    // Lighter fog for a "Lab" feel rather than "Void"
    scene.fog = new THREE.FogExp2(0x111116, 0.015); 
    scene.background = new THREE.Color(0x111116);

    // 2. Setup Camera
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(10, 6, 15);

    // 3. Setup Renderer (High Quality)
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap pixel ratio for performance
    container.appendChild(renderer.domElement);

    // 4. Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 40;

    // 5. Lighting (Much Brighter / Better illuminated)
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2.0);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = false; // Shadow disabled for performance
    scene.add(dirLight);

    // 6. Tunnel & Objects
    createTunnelWalls();
    createObstacle('wing');
    initParticles();

    // 7. Events
    window.addEventListener('resize', onWindowResize);
    setupUI();
}

function createTunnelWalls() {
    const d = CONFIG.domainSize;
    const geometry = new THREE.BoxGeometry(d.x, d.y, d.z);
    const edges = new THREE.EdgesGeometry(geometry);
    // Lighter grid lines
    const material = new THREE.LineBasicMaterial({ color: 0x555566, opacity: 0.2, transparent: true });
    const wireframe = new THREE.LineSegments(edges, material);
    scene.add(wireframe);

    // Floor
    const gridHelper = new THREE.GridHelper(d.x, 20, 0x555566, 0x22222a);
    gridHelper.position.y = -d.y / 2;
    gridHelper.scale.x = 1;
    scene.add(gridHelper);
}

function createObstacle(type) {
    if (obstacleMesh) {
        scene.remove(obstacleMesh);
        if(obstacleMesh.geometry) obstacleMesh.geometry.dispose();
    }

    // Material: Sleek aerodynamic white/grey
    const material = new THREE.MeshStandardMaterial({
        color: 0xeeeeee,
        metalness: 0.6,
        roughness: 0.3,
        emissive: 0x222222,
    });

    let geometry;

    if (type === 'sphere') {
        geometry = new THREE.SphereGeometry(2.5, 32, 32);
    } 
    else if (type === 'cube') {
        geometry = new THREE.BoxGeometry(3.5, 3.5, 3.5);
    }
    else if (type === 'car') {
        // Simple "Car" shape using combined boxes
        geometry = new THREE.BoxGeometry(4, 1.5, 2);
        const top = new THREE.BoxGeometry(2, 1, 1.8);
        top.translate(-0.5, 1.25, 0);
        // Merging logic is complex in vanilla Three, sticking to simple group or just a box approximation for now
        // For simplicity in this script, we'll use a "blocky" car shape via a single geometry if possible, 
        // or just revert to a box if too complex. Let's do a fast "Slope" for car:
        const shape = new THREE.Shape();
        shape.moveTo(0,0); shape.lineTo(4,0); shape.lineTo(4,1); shape.lineTo(3,1.5); shape.lineTo(1,1.5); shape.lineTo(0,0.8);
        const extrudeSettings = { steps: 1, depth: 2.2, bevelEnabled: true, bevelThickness:0.1 };
        geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geometry.center();
        geometry.rotateZ(Math.PI); // Fix orientation
        geometry.rotateY(Math.PI);
    }
    else { // Wing
        const shape = new THREE.Shape();
        const chord = 5;
        const thickness = 0.8;
        shape.moveTo(chord/2, 0);
        shape.bezierCurveTo(chord/2, thickness, -chord/2, thickness/2, -chord/2, 0);
        shape.bezierCurveTo(-chord/2, -thickness/2, chord/2, -thickness, chord/2, 0);

        const extrudeSettings = { steps: 2, depth: 8, bevelEnabled: false };
        geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geometry.center(); 
        geometry.rotateY(Math.PI / 2); 
    }

    obstacleMesh = new THREE.Mesh(geometry, material);
    scene.add(obstacleMesh);
}

function initParticles() {
    if (particlesMesh) {
        scene.remove(particlesMesh);
        particlesMesh.geometry.dispose();
        particlesMesh.material.dispose();
    }

    // 1. Create the geometry
    const geometry = new THREE.BoxGeometry(0.8, 0.05, 0.05); 
    
    // --- ADD THIS LINE TO FIX ROTATION ---
    geometry.rotateY(Math.PI / 2); 
    // -------------------------------------

    const material = new THREE.MeshBasicMaterial({ 
        color: 0x00ffff, 
        transparent: true, 
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        depthWrite: false 
    });

    particlesMesh = new THREE.InstancedMesh(geometry, material, CONFIG.particleCount);
    particlesMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(particlesMesh);

    particleData = [];
    const d = CONFIG.domainSize;

    for (let i = 0; i < CONFIG.particleCount; i++) {
        const x = (Math.random() - 0.5) * d.x;
        const y = (Math.random() - 0.5) * d.y * 0.8;
        const z = (Math.random() - 0.5) * d.z * 0.8;
        
        particleData.push({
            position: new THREE.Vector3(x, y, z),
            velocity: new THREE.Vector3(0,0,0),
            // Randomize speed slightly to prevent "stuttering" patterns
            speedOffset: 0.8 + Math.random() * 0.4, 
            life: Math.random() // Used for flicker
        });
    }
}

function updateParticles() {
    if (CONFIG.pause) return;

    const simSpeed = kmhToSim(CONFIG.windKmh);
    const obstaclePos = obstacleMesh.position;
    const d = CONFIG.domainSize;
    
    // Collision Settings
    let radius = 2.5; 
    let repulsionStrength = 0.8;
    if (currentShapeType === 'wing') { radius = 1.8; repulsionStrength = 0.6; }
    if (currentShapeType === 'sphere') { radius = 2.8; repulsionStrength = 1.2; }

    const objMatrix = new THREE.Matrix4();
    
    for (let i = 0; i < CONFIG.particleCount; i++) {
        const p = particleData[i];
        
        // 1. Basic Wind Movement
        // Speed increases slightly if particles are squeezed around object (Venturi effect fake)
        let currentSpeed = simSpeed * p.speedOffset;

        // 2. Obstacle Avoidance (Potential Flow Approximation)
        const dist = p.position.distanceTo(obstaclePos);
        
        if (dist < radius * 3.0) {
            // Push away
            const repulsion = p.position.clone().sub(obstaclePos).normalize();
            
            // Force strength falls off with distance
            const force = (1.0 - (dist / (radius * 3.0))) * repulsionStrength * currentSpeed;
            
            // Wing specific: less lateral deflection
            if (currentShapeType === 'wing') {
                repulsion.z *= 0.1;
                repulsion.x *= 0.2; 
            }
            
            // Add repulsion to velocity (fake diversion)
            p.velocity.set(currentSpeed, 0, 0).add(repulsion.multiplyScalar(force * 2));
            
            // Accelerate near object (Bernoulli principle visual fake)
            currentSpeed *= 1.1;
        } else {
            // Default smooth laminar flow
            // Add slight sine wave for "turbulence" far downstream
            if (p.position.x > 2.0) {
                p.velocity.set(currentSpeed, Math.sin(p.position.x * 0.5 + p.life * 10)*0.05, 0);
            } else {
                p.velocity.set(currentSpeed, 0, 0);
            }
        }

        // 3. Move
        p.position.add(p.velocity);

        // 4. Recycle
        if (p.position.x > d.x / 2) {
            p.position.x = -d.x / 2;
            p.position.y = (Math.random() - 0.5) * d.y * 0.8;
            p.position.z = (Math.random() - 0.5) * d.z * 0.8;
        }

        // 5. Update Visuals
        dummy.position.copy(p.position);
        
        // Stretch: The faster it goes, the longer the "vapor trail"
        // At 300km/h, lines should be very long
        const stretch = Math.max(1.0, currentSpeed * 4.0);
        dummy.scale.set(stretch, 1, 1);
        
        // Look ahead
        const lookTarget = p.position.clone().add(p.velocity);
        dummy.lookAt(lookTarget);
        
        dummy.updateMatrix();
        particlesMesh.setMatrixAt(i, dummy.matrix);
    }
    
    particlesMesh.instanceMatrix.needsUpdate = true;
}

function animate() {
    requestAnimationFrame(animate);
    updateParticles();
    if (CONFIG.autoRotate) {
        controls.autoRotate = true;
        controls.update();
    }
    renderer.render(scene, camera);
}

function setupUI() {
    // Inputs
    const speedInput = document.getElementById('windSpeed');
    const shapeSelect = document.getElementById('shapeSelect');
    const particleInput = document.getElementById('particleCount');
    const rotateToggle = document.getElementById('rotateToggle');
    const resetCamBtn = document.getElementById('resetCam');
    const pauseBtn = document.getElementById('pauseBtn');

    // Display elements
    const speedVal = document.getElementById('speedValue');
    const countVal = document.getElementById('countValue');

    speedInput.addEventListener('input', (e) => {
        CONFIG.windKmh = parseInt(e.target.value);
        speedVal.textContent = CONFIG.windKmh + ' km/h';
    });

    shapeSelect.addEventListener('change', (e) => {
        currentShapeType = e.target.value;
        createObstacle(currentShapeType);
    });

    particleInput.addEventListener('input', (e) => {
        CONFIG.particleCount = parseInt(e.target.value);
        countVal.textContent = CONFIG.particleCount;
        initParticles();
    });

    rotateToggle.addEventListener('change', (e) => {
        CONFIG.autoRotate = e.target.checked;
        controls.autoRotate = e.target.checked;
    });

    resetCamBtn.addEventListener('click', () => {
        camera.position.set(10, 6, 15);
        camera.lookAt(0,0,0);
        controls.reset();
    });

    pauseBtn.addEventListener('click', () => {
        CONFIG.pause = !CONFIG.pause;
        pauseBtn.innerHTML = CONFIG.pause ? '<i class="fas fa-play"></i> Play' : '<i class="fas fa-pause"></i> Pause';
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}