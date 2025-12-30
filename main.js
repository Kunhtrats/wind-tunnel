/**
 * WebGL2 Aero Lab V3
 * - F1 Car & Fighter Jet SDFs
 * - Ground Effect (Floor)
 * - Preset System
 */

const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2');

if (!gl) alert("WebGL2 not supported. Try Chrome/Firefox on Desktop.");

gl.getExtension('EXT_color_buffer_float');
gl.getExtension('OES_texture_float_linear');

// --- Configuration ---
const CONFIG = {
    simRes: 256,
    dyeRes: 512,
    iterations: 20,
    windSpeed: 1.0,
    viscosity: 0.0,
    pause: false,
    obstaclePos: { x: 0.4, y: 0.5 }, 
    obstacleRadius: 0.08, // Scale factor for shapes
    shapeType: 0, 
    colorMode: false,
    hasFloor: true
};

// --- SDF Library (The Physics Geometry) ---
const sdfLibrary = `
uniform int u_shapeType;
uniform vec2 u_obstaclePos;
uniform float u_obstacleRad; // This acts as a scale multiplier
uniform vec2 u_aspectRatio;
uniform bool u_hasFloor;

// Smooth Minimum (for blending shapes organically)
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Primitives
float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p)-b;
    return length(max(d,0.0)) + min(max(d.x,d.y),0.0);
}
float sdCircle(vec2 p, float r) {
    return length(p) - r;
}

// 1. F1 Car SDF
float sdF1Car(vec2 p, float scale) {
    p.x = -p.x; // Face wind
    p /= scale * 8.0; // Normalize size
    
    // Body (low, long)
    float body = sdBox(p - vec2(0.0, -0.2), vec2(1.2, 0.25));
    // Cockpit
    float cockpit = sdCircle(p - vec2(-0.2, 0.1), 0.35);
    body = smin(body, cockpit, 0.2);
    
    // Rear Wing (high, boxy)
    float rWing = sdBox(p - vec2(-1.1, 0.5), vec2(0.3, 0.05));
    float rWingSupport = sdBox(p - vec2(-1.0, 0.2), vec2(0.05, 0.3));
    
    // Front Wing
    float fWing = sdBox(p - vec2(1.3, -0.4), vec2(0.4, 0.05));
    
    // Wheels (Circles)
    float fWheel = sdCircle(p - vec2(0.9, -0.3), 0.35);
    float rWheel = sdCircle(p - vec2(-0.8, -0.3), 0.38);
    
    // Combine
    float car = min(body, rWing);
    car = min(car, rWingSupport);
    car = min(car, fWing);
    car = min(car, fWheel);
    car = min(car, rWheel);
    
    return car * scale * 8.0; // Return to world scale
}

// 2. Fighter Jet SDF
float sdJet(vec2 p, float scale) {
    p.x = -p.x;
    p /= scale * 8.0;
    
    // Fuselage (pointy nose)
    float fuselage = sdBox(p, vec2(1.5, 0.25));
    fuselage = smin(fuselage, length(p - vec2(1.8, 0.0)) - 0.1, 0.8); // nose blend
    
    // Wings (Triangle approx)
    vec2 wp = p - vec2(-0.2, 0.0);
    float wings = max(abs(wp.y) - wp.x * 0.3, abs(wp.x) - 1.0); // Rough delta
    
    // Tail
    float tail = sdBox(p - vec2(-1.4, 0.4), vec2(0.3, 0.3));
    
    float jet = smin(fuselage, wings, 0.2);
    jet = min(jet, tail);
    
    return jet * scale * 8.0;
}

float getObstacleSDF(vec2 uv) {
    vec2 p = uv - u_obstaclePos;
    p.x *= u_aspectRatio.x / u_aspectRatio.y; 
    
    float dist = 1e5;
    
    if (u_shapeType == 0) dist = length(p) - u_obstacleRad; // Cylinder
    else if (u_shapeType == 1) dist = sdBox(p, vec2(u_obstacleRad)); // Box
    else if (u_shapeType == 2) { // Airfoil
        p.x = -p.x; p.x *= 0.8; 
        float x = p.x + 0.5;
        float y = 0.0;
        if(x >= 0.0 && x <= 1.0) y = 0.5 * 0.2 * (0.2969*sqrt(x) - 0.1260*x - 0.3516*x*x + 0.2843*x*x*x - 0.1015*x*x*x*x);
        y *= (u_obstacleRad * 15.0);
        if(x < 0.0 || x > 1.0) dist = length(p) - 0.1;
        else dist = abs(p.y) - y;
    }
    else if (u_shapeType == 3) dist = sdF1Car(p, u_obstacleRad);
    else if (u_shapeType == 4) dist = sdJet(p, u_obstacleRad);
    
    // --- THE FLOOR ---
    if(u_hasFloor) {
        // Floor is at UV y = 0.1 (near bottom)
        // We calculate distance to this line
        float floorDist = uv.y - 0.05; 
        dist = min(dist, floorDist);
    }

    return dist;
}
`;

// --- Shader Sources (Standard Boilerplate with SDF Injection) ---

const baseVertexShader = `#version 300 es
in vec2 a_position; out vec2 v_uv;
void main() { v_uv = a_position * 0.5 + 0.5; gl_Position = vec4(a_position, 0, 1); }`;

const advectionShader = `#version 300 es
precision highp float; in vec2 v_uv;
uniform sampler2D u_velocity; uniform sampler2D u_source;
uniform float dt; uniform float dissipation; out vec4 fragColor;
void main() {
    vec2 velocity = texture(u_velocity, v_uv).xy;
    vec4 result = texture(u_source, v_uv - velocity * dt);
    fragColor = result * dissipation;
}`;

const divergenceShader = `#version 300 es
precision highp float; in vec2 v_uv;
uniform sampler2D u_velocity; uniform vec2 u_texelSize; out float fragColor;
void main() {
    float L = texture(u_velocity, v_uv - vec2(u_texelSize.x, 0)).x;
    float R = texture(u_velocity, v_uv + vec2(u_texelSize.x, 0)).x;
    float T = texture(u_velocity, v_uv + vec2(0, u_texelSize.y)).y;
    float B = texture(u_velocity, v_uv - vec2(0, u_texelSize.y)).y;
    fragColor = 0.5 * (R - L + T - B);
}`;

const jacobiShader = `#version 300 es
precision highp float; in vec2 v_uv;
uniform sampler2D u_x; uniform sampler2D u_b;
uniform float alpha; uniform float beta; uniform vec2 u_texelSize; out vec4 fragColor;
void main() {
    vec4 L = texture(u_x, v_uv - vec2(u_texelSize.x, 0));
    vec4 R = texture(u_x, v_uv + vec2(u_texelSize.x, 0));
    vec4 T = texture(u_x, v_uv + vec2(0, u_texelSize.y));
    vec4 B = texture(u_x, v_uv - vec2(0, u_texelSize.y));
    vec4 bC = texture(u_b, v_uv);
    fragColor = (L + R + T + B + alpha * bC) * beta;
}`;

const gradientSubtractShader = `#version 300 es
precision highp float; in vec2 v_uv;
uniform sampler2D u_pressure; uniform sampler2D u_velocity; uniform vec2 u_texelSize; out vec2 fragColor;
void main() {
    float L = texture(u_pressure, v_uv - vec2(u_texelSize.x, 0)).x;
    float R = texture(u_pressure, v_uv + vec2(u_texelSize.x, 0)).x;
    float T = texture(u_pressure, v_uv + vec2(0, u_texelSize.y)).x;
    float B = texture(u_pressure, v_uv - vec2(0, u_texelSize.y)).x;
    vec2 velocity = texture(u_velocity, v_uv).xy;
    velocity.xy -= vec2(R - L, T - B);
    fragColor = velocity;
}`;

const splatShader = `#version 300 es
precision highp float; in vec2 v_uv;
uniform sampler2D u_target; uniform vec2 u_point; uniform vec3 u_color;
uniform float u_radius; uniform vec2 u_windSpeed;
${sdfLibrary}
out vec4 fragColor;
void main() {
    vec3 result = texture(u_target, v_uv).xyz;
    vec2 p = v_uv - u_point.xy; p.x *= u_aspectRatio.x / u_aspectRatio.y;
    result += exp(-dot(p, p) / u_radius) * u_color;
    
    // Wind inflow
    if(v_uv.x < 0.05) {
       // Ramp up wind near floor to avoid hard shear
       float floorFactor = u_hasFloor ? smoothstep(0.0, 0.1, v_uv.y) : 1.0;
       result += vec3(u_windSpeed, 0.0) * 0.1 * floorFactor; 
    }

    if (getObstacleSDF(v_uv) < 0.0) result = vec3(0.0);
    fragColor = vec4(result, 1.0);
}`;

const displayShader = `#version 300 es
precision highp float; in vec2 v_uv;
uniform sampler2D u_dye; uniform sampler2D u_velocity;
${sdfLibrary}
out vec4 fragColor;
void main() {
    vec3 color = texture(u_dye, v_uv).rgb;
    float dist = getObstacleSDF(v_uv);
    
    // Visualizing the object
    if(dist < 0.0) {
        color = vec3(0.15, 0.15, 0.2); // Dark body
        // Add subtle shading based on distance
        color += vec3(0.05) * sin(dist * 100.0);
    }
    
    // Outline
    float edge = 1.0 - smoothstep(0.0, 0.003, abs(dist));
    color = mix(color, vec3(0.0, 0.8, 1.0), edge);
    
    fragColor = vec4(color, 1.0);
}`;

const stripeShader = `#version 300 es
precision highp float; in vec2 v_uv;
uniform sampler2D u_target; uniform int u_colorMode; uniform bool u_hasFloor;
out vec4 fragColor;
void main() {
    vec4 color = texture(u_target, v_uv);
    if(v_uv.x < 0.005) {
        // If floor is enabled, don't inject ink at the very bottom
        if(!u_hasFloor || v_uv.y > 0.06) {
            float pattern = step(0.5, sin(v_uv.y * 3.14159 * 40.0));
            vec3 c = u_colorMode == 1 ? (0.5 + 0.5 * cos(vec3(0,2,4) + v_uv.y * 5.0)) : vec3(1.0);
            color = mix(color, vec4(c * pattern, 1.0), 0.5);
        }
    }
    fragColor = color;
}`;

// --- Classes (Same as before) ---
class Program {
    constructor(gl, vs, fs) {
        this.program = gl.createProgram();
        const v = this.createShader(gl.VERTEX_SHADER, vs);
        const f = this.createShader(gl.FRAGMENT_SHADER, fs);
        gl.attachShader(this.program, v); gl.attachShader(this.program, f);
        gl.linkProgram(this.program);
        this.uniforms = {};
        const count = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
        for(let i=0; i<count; i++) {
            const name = gl.getActiveUniform(this.program, i).name;
            this.uniforms[name] = gl.getUniformLocation(this.program, name);
        }
    }
    createShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
        return s;
    }
    bind() { gl.useProgram(this.program); }
}
class FBO {
    constructor(w, h) {
        this.gl = gl; this.w = w; this.h = h;
        this.texA = this.cTex(w,h); this.texB = this.cTex(w,h);
        this.fbo = gl.createFramebuffer();
    }
    cTex(w, h) {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
    }
    swap() { [this.texA, this.texB] = [this.texB, this.texA]; }
    get read() { return this.texA; } get write() { return this.texB; }
}

// --- Setup ---
let programs = {}, fbos = {}, blitQuad;

function init() {
    blitQuad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, blitQuad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, -1,1, 1,1, 1,-1]), gl.STATIC_DRAW);

    programs.advect = new Program(gl, baseVertexShader, advectionShader);
    programs.div = new Program(gl, baseVertexShader, divergenceShader);
    programs.jacobi = new Program(gl, baseVertexShader, jacobiShader);
    programs.sub = new Program(gl, baseVertexShader, gradientSubtractShader);
    programs.splat = new Program(gl, baseVertexShader, splatShader);
    programs.disp = new Program(gl, baseVertexShader, displayShader);
    programs.stripe = new Program(gl, baseVertexShader, stripeShader);

    fbos.vel = new FBO(CONFIG.simRes, CONFIG.simRes);
    fbos.p = new FBO(CONFIG.simRes, CONFIG.simRes); // Pressure
    fbos.div = new FBO(CONFIG.simRes, CONFIG.simRes); // Divergence
    fbos.dye = new FBO(CONFIG.dyeRes, CONFIG.dyeRes);

    requestAnimationFrame(update);
}

function blit(fbo) {
    gl.bindBuffer(gl.ARRAY_BUFFER, blitQuad);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo ? fbo.fbo : null);
    if(fbo) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbo.write, 0);
    gl.viewport(0, 0, fbo?fbo.w:canvas.width, fbo?fbo.h:canvas.height);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    if(fbo) fbo.swap();
}

function setUniforms(p) {
    gl.uniform2f(p.uniforms.u_aspectRatio, canvas.width, canvas.height);
    gl.uniform1i(p.uniforms.u_shapeType, CONFIG.shapeType);
    gl.uniform2f(p.uniforms.u_obstaclePos, CONFIG.obstaclePos.x, CONFIG.obstaclePos.y);
    gl.uniform1f(p.uniforms.u_obstacleRad, CONFIG.obstacleRadius);
    gl.uniform1i(p.uniforms.u_hasFloor, CONFIG.hasFloor);
}

let lastTime = Date.now();
function update() {
    if(!CONFIG.pause) {
        // Physics
        programs.advect.bind();
        gl.uniform1i(programs.advect.uniforms.u_velocity, 0);
        gl.uniform1i(programs.advect.uniforms.u_source, 0);
        gl.uniform1f(programs.advect.uniforms.dt, 0.016);
        gl.uniform1f(programs.advect.uniforms.dissipation, 1.0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbos.vel.read);
        blit(fbos.vel);

        // Viscosity (if needed)
        if(CONFIG.viscosity > 0) {
            programs.jacobi.bind();
            const alpha = 1.0 / (CONFIG.viscosity * 0.016);
            gl.uniform1f(programs.jacobi.uniforms.alpha, alpha);
            gl.uniform1f(programs.jacobi.uniforms.beta, 1.0 / (4.0 + alpha));
            gl.uniform2f(programs.jacobi.uniforms.u_texelSize, 1.0/CONFIG.simRes, 1.0/CONFIG.simRes);
            for(let i=0; i<10; i++) {
                gl.uniform1i(programs.jacobi.uniforms.u_x, 0); gl.uniform1i(programs.jacobi.uniforms.u_b, 1);
                gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbos.vel.read);
                gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fbos.vel.read);
                blit(fbos.vel);
            }
        }

        // Force/Boundaries
        programs.splat.bind();
        setUniforms(programs.splat);
        gl.uniform1i(programs.splat.uniforms.u_target, 0);
        gl.uniform2f(programs.splat.uniforms.u_point, pointers[0].x, pointers[0].y);
        gl.uniform3f(programs.splat.uniforms.u_color, pointers[0].dx, pointers[0].dy, 0.0);
        gl.uniform1f(programs.splat.uniforms.u_radius, 0.005);
        gl.uniform2f(programs.splat.uniforms.u_windSpeed, CONFIG.windSpeed, 0.0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbos.vel.read);
        blit(fbos.vel);

        // Projection
        programs.div.bind();
        gl.uniform1i(programs.div.uniforms.u_velocity, 0);
        gl.uniform2f(programs.div.uniforms.u_texelSize, 1.0/CONFIG.simRes, 1.0/CONFIG.simRes);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbos.vel.read);
        blit(fbos.div);

        programs.jacobi.bind();
        gl.uniform1f(programs.jacobi.uniforms.alpha, -1.0);
        gl.uniform1f(programs.jacobi.uniforms.beta, 0.25);
        gl.uniform2f(programs.jacobi.uniforms.u_texelSize, 1.0/CONFIG.simRes, 1.0/CONFIG.simRes);
        gl.uniform1i(programs.jacobi.uniforms.u_b, 1);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fbos.div.read);
        for(let i=0; i<CONFIG.iterations; i++) {
            gl.uniform1i(programs.jacobi.uniforms.u_x, 0);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbos.p.read);
            blit(fbos.p);
        }

        programs.sub.bind();
        gl.uniform1i(programs.sub.uniforms.u_pressure, 0);
        gl.uniform1i(programs.sub.uniforms.u_velocity, 1);
        gl.uniform2f(programs.sub.uniforms.u_texelSize, 1.0/CONFIG.simRes, 1.0/CONFIG.simRes);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbos.p.read);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fbos.vel.read);
        blit(fbos.vel);

        // Dye
        programs.advect.bind();
        gl.uniform1i(programs.advect.uniforms.u_velocity, 0);
        gl.uniform1i(programs.advect.uniforms.u_source, 1);
        gl.uniform1f(programs.advect.uniforms.dt, 0.016);
        gl.uniform1f(programs.advect.uniforms.dissipation, 0.992);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbos.vel.read);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fbos.dye.read);
        blit(fbos.dye);

        if(pointers[0].down) {
            programs.splat.bind();
            setUniforms(programs.splat);
            gl.uniform1i(programs.splat.uniforms.u_target, 0);
            gl.uniform2f(programs.splat.uniforms.u_point, pointers[0].x, pointers[0].y);
            gl.uniform3f(programs.splat.uniforms.u_color, 1.0, 1.0, 1.0);
            gl.uniform1f(programs.splat.uniforms.u_radius, 0.002);
            gl.uniform2f(programs.splat.uniforms.u_windSpeed, 0, 0);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbos.dye.read);
            blit(fbos.dye);
        }
        
        if(CONFIG.windSpeed > 0) {
            programs.stripe.bind();
            gl.uniform1i(programs.stripe.uniforms.u_target, 0);
            gl.uniform1i(programs.stripe.uniforms.u_colorMode, CONFIG.colorMode?1:0);
            gl.uniform1i(programs.stripe.uniforms.u_hasFloor, CONFIG.hasFloor);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbos.dye.read);
            blit(fbos.dye);
        }
    }

    programs.disp.bind();
    setUniforms(programs.disp);
    gl.uniform1i(programs.disp.uniforms.u_dye, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbos.dye.read);
    blit(null);
    if(!CONFIG.pause) requestAnimationFrame(update);
}

// --- Interaction & Presets ---
const PRESETS = {
    'cruise': { wind: 1.5, visc: 0, shape: 3, floor: true, color: false },
    'f1': { wind: 2.5, visc: 0, shape: 3, floor: true, color: true },
    'storm': { wind: 4.0, visc: 0, shape: 2, floor: true, color: false },
    'jelly': { wind: 0.5, visc: 20, shape: 1, floor: false, color: true }
};

function applyPreset(name) {
    const p = PRESETS[name];
    CONFIG.windSpeed = p.wind;
    CONFIG.viscosity = p.visc;
    CONFIG.shapeType = p.shape;
    CONFIG.hasFloor = p.floor;
    CONFIG.colorMode = p.color;
    
    // Sync UI
    document.getElementById('windSpeed').value = p.wind;
    document.getElementById('viscosity').value = p.visc;
    document.getElementById('shapeSelect').value = p.shape;
    document.getElementById('floorToggle').checked = p.floor;
    document.getElementById('val-wind').innerText = p.wind;
    document.getElementById('val-visc').innerText = p.visc;
    
    // Clear dye for fresh start
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.dye.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
}

document.querySelectorAll('.preset-btn').forEach(b => {
    b.onclick = (e) => applyPreset(e.target.dataset.preset);
});

// Bindings
let pointers = [{x:0,y:0,dx:0,dy:0,down:false}];
canvas.onmousedown = e => { if(e.button===2) { CONFIG.obstaclePos={x:e.offsetX/canvas.width, y:1.0-e.offsetY/canvas.height}; } else pointers[0].down=true; };
canvas.onmousemove = e => { 
    pointers[0].x=e.offsetX/canvas.width; pointers[0].y=1.0-e.offsetY/canvas.height; 
    pointers[0].dx=(e.movementX/canvas.width)*5; pointers[0].dy=-(e.movementY/canvas.height)*5;
    if(e.buttons===2) CONFIG.obstaclePos={x:pointers[0].x, y:pointers[0].y};
};
canvas.onmouseup = () => pointers[0].down=false;
canvas.oncontextmenu = e => e.preventDefault();
window.onresize = () => { canvas.width=window.innerWidth; canvas.height=window.innerHeight; };

document.getElementById('windSpeed').oninput=e=>{ CONFIG.windSpeed=parseFloat(e.target.value); document.getElementById('val-wind').innerText=CONFIG.windSpeed; };
document.getElementById('viscosity').oninput=e=>{ CONFIG.viscosity=parseFloat(e.target.value); document.getElementById('val-visc').innerText=CONFIG.viscosity; };
document.getElementById('shapeSelect').onchange=e=>{ CONFIG.shapeType=parseInt(e.target.value); };
document.getElementById('floorToggle').onchange=e=>{ CONFIG.hasFloor=e.target.checked; };
document.getElementById('resetDye').onclick=()=>{ gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.dye.fbo); gl.clear(gl.COLOR_BUFFER_BIT); };
document.getElementById('toggleColor').onclick=e=>{ CONFIG.colorMode=!CONFIG.colorMode; };
document.getElementById('pauseBtn').onclick=()=>{ CONFIG.pause=!CONFIG.pause; update(); };
document.getElementById('toggleUI').onclick=()=>{ const ui=document.getElementById('controls'); ui.style.display=ui.style.display==='none'?'block':'none'; };

init();