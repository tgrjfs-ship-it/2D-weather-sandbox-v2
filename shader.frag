// Fragment Shader — Volumetric Clouds + Lighting + HDR
// Built from scratch for 2D Weather Sandbox (Three.js)

precision highp float;

uniform float iTime;
uniform vec3  iResolution;
uniform vec3  sunDirection;
uniform float temperature;
uniform float humidity;
uniform float dayPhase;

varying vec2 vUv;

// ------------------------------------------------------------
// Utility Noise (value-based, fast for cloud density)
// ------------------------------------------------------------
float hash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 73.2, 45.3))) * 43758.5453); }

float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f*f*(3.0 - 2.0*f);
    float n =
        mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    return n;
}

float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for(int i=0;i<5;i++){
        v += a * noise(p);
        p *= 2.02;
        a *= 0.5;
    }
    return v;
}

// ------------------------------------------------------------
// Raymarch volumetric clouds
// ------------------------------------------------------------
vec3 renderClouds(vec2 uv, vec3 ro, vec3 rd, vec3 sunDir, float temp, float hum, float time) {
    float cloudBase = 0.3 + 0.1 * sin(time*0.05);
    float cloudTop  = 1.2;
    float steps = 32.0;
    float stepSize = (cloudTop - cloudBase) / steps;
    float densityAccum = 0.0;
    vec3  colorAccum = vec3(0.0);
    vec3 lightColor = mix(vec3(0.2,0.3,0.5), vec3(1.0,0.9,0.7), clamp(sunDir.y*0.5+0.5,0.0,1.0));

    for(float i=0.0;i<32.0;i++){
        float h = cloudBase + stepSize*i;
        vec3 pos = ro + rd * h;
        float n = fbm(pos*2.0 + vec3(0.0, time*0.02, 0.0));
        float dens = smoothstep(0.55, 1.0, n + (hum*0.5 - temp*0.3));
        dens *= (1.0 - densityAccum) * 0.3;
        vec3 shade = lightColor * dens * max(dot(normalize(sunDir), vec3(0.0,1.0,0.0)),0.2);
        colorAccum += shade;
        densityAccum += dens * 0.5;
        if(densityAccum > 1.0) break;
    }
    colorAccum = mix(vec3(0.4,0.5,0.8), colorAccum, densityAccum);
    return colorAccum;
}

// ------------------------------------------------------------
// Tone mapping & day/night color grading
// ------------------------------------------------------------
vec3 toneMap(vec3 c) {
    // ACES approximation
    float a = 2.51; float b = 0.03; float c1 = 2.43; float d = 0.59; float e = 0.14;
    return clamp((c*(a*c + b)) / (c*(c1*c + d) + e), 0.0, 1.0);
}

void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    // Camera ray setup
    vec3 ro = vec3(0.0, 0.0, -1.0);
    vec3 rd = normalize(vec3(uv, 1.5));

    // Day/night hue and ambient tone
    float sunAngle = dayPhase * 6.2831;
    float daylight = clamp(sin(sunAngle)*0.5+0.5, 0.05, 1.0);
    vec3 skyCol = mix(vec3(0.02,0.02,0.05), vec3(0.5,0.7,1.0), daylight);

    // Volumetric clouds
    vec3 clouds = renderClouds(uv, ro, rd, normalize(sunDirection), temperature, humidity, iTime);

    // Combine sky + clouds + HDR light
    vec3 color = mix(skyCol, clouds, 0.9);
    color *= mix(0.2, 1.5, daylight);

    // Slight sun glow
    float sunGlow = pow(max(dot(rd, normalize(sunDirection)), 0.0), 250.0);
    color += vec3(1.2,1.0,0.7) * sunGlow * daylight;

    // HDR tone mapping
    color = toneMap(color);

    gl_FragColor = vec4(color, 1.0);
}
