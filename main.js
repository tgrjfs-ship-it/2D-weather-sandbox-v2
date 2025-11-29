import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const VolumetricClouds = () => {
  const containerRef = useRef(null);
  const [stats, setStats] = useState({
    cloudCount: 0,
    precipitation: 'None',
    temperature: 20,
    humidity: 50,
    windSpeed: 0,
    cloudTypes: {}
  });
  const [controls, setControls] = useState({
    evaporationRate: 1.0,
    simulationSpeed: 1.0,
    windSpeed: 1.0,
    humidity: 50
  });
  const [guiVisible, setGuiVisible] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 50, 200);

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 1.7, 0); // Eye level at surface
    camera.lookAt(0, 1.7, 10);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff4e6, 1.2);
    sunLight.position.set(50, 80, 30);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    scene.add(sunLight);

    const backLight = new THREE.DirectionalLight(0x6ba3ff, 0.4);
    backLight.position.set(-50, 30, -50);
    scene.add(backLight);

    // Enhanced cloud shader with better volumetric texture
    const createCloudMaterial = () => new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        density: { value: 0.45 },
        lightColor: { value: new THREE.Color(0xffffff) },
        shadowColor: { value: new THREE.Color(0x6688aa) },
        moisture: { value: 0.5 },
        sunPosition: { value: new THREE.Vector3(1, 1, 0.5) }
      },
      vertexShader: `
        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        
        void main() {
          vPosition = position;
          vNormal = normalize(normalMatrix * normal);
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float density;
        uniform vec3 lightColor;
        uniform vec3 shadowColor;
        uniform float moisture;
        uniform vec3 sunPosition;
        
        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        
        float hash(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yxz + 33.33);
          return fract((p.x + p.y) * p.z);
        }
        
        float noise(vec3 x) {
          vec3 p = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          
          return mix(
            mix(mix(hash(p + vec3(0,0,0)), hash(p + vec3(1,0,0)), f.x),
                mix(hash(p + vec3(0,1,0)), hash(p + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(p + vec3(0,0,1)), hash(p + vec3(1,0,1)), f.x),
                mix(hash(p + vec3(0,1,1)), hash(p + vec3(1,1,1)), f.x), f.y),
            f.z
          );
        }
        
        float fbm(vec3 p) {
          float f = 0.0;
          float scale = 1.0;
          float weight = 0.5;
          
          for(int i = 0; i < 8; i++) {
            f += weight * noise(p * scale);
            scale *= 2.07;
            weight *= 0.5;
          }
          
          return f;
        }
        
        float worley(vec3 p) {
          vec3 id = floor(p);
          vec3 fd = fract(p);
          
          float minDist = 1.0;
          
          for(int x = -1; x <= 1; x++) {
            for(int y = -1; y <= 1; y++) {
              for(int z = -1; z <= 1; z++) {
                vec3 coord = vec3(float(x), float(y), float(z));
                vec3 point = hash(id + coord) * vec3(1.0) + coord;
                float dist = length(point - fd);
                minDist = min(minDist, dist);
              }
            }
          }
          
          return minDist;
        }
        
        void main() {
          vec3 pos = vWorldPosition * 0.08;
          pos.x += time * 0.02;
          pos.y += time * 0.01;
          
          float n1 = fbm(pos * 0.8);
          float n2 = fbm(pos * 2.0 + vec3(time * 0.1));
          float n3 = worley(pos * 1.5);
          
          float density_map = n1 * 0.6 + n2 * 0.3 + (1.0 - n3) * 0.4;
          density_map = smoothstep(0.35, 0.85, density_map);
          
          float edgeFade = 1.0 - smoothstep(0.3, 1.0, length(vUv - 0.5) * 2.0);
          density_map *= edgeFade;
          
          vec3 lightDir = normalize(sunPosition);
          float NdotL = dot(vNormal, lightDir);
          
          float backScatter = max(0.0, -NdotL) * 0.6;
          float frontLight = max(0.0, NdotL);
          
          float lightAmount = frontLight * 0.7 + backScatter + 0.3;
          
          vec3 darkColor = mix(shadowColor, vec3(0.15, 0.15, 0.25), moisture * 0.7);
          vec3 brightColor = mix(lightColor, vec3(1.0, 0.98, 0.95), 0.3);
          
          vec3 color = mix(darkColor, brightColor, lightAmount);
          
          float rim = 1.0 - abs(dot(vNormal, vec3(0, 0, 1)));
          rim = pow(rim, 3.0) * 0.3;
          color += vec3(rim);
          
          float finalDensity = density_map * density * (0.6 + moisture * 0.4);
          
          color += noise(vWorldPosition * 3.0) * 0.05;
          
          gl_FragColor = vec4(color, finalDensity);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    // Wind system
    class WindSystem {
      constructor() {
        this.baseSpeed = 0.03;
        this.direction = new THREE.Vector2(1, 0);
        this.turbulence = 0;
        this.gustTimer = 0;
        this.gustDuration = 0;
        this.windShear = 0.3;
      }

      update(deltaTime) {
        const dirChange = Math.sin(Date.now() * 0.0001) * 0.01;
        this.direction.x = Math.cos(dirChange);
        this.direction.y = Math.sin(dirChange);
        this.direction.normalize();
        
        this.gustTimer -= deltaTime;
        if (this.gustTimer <= 0) {
          this.gustTimer = 5 + Math.random() * 10;
          this.gustDuration = 2 + Math.random() * 3;
          this.turbulence = Math.random() * 0.5;
        }
        
        if (this.gustDuration > 0) {
          this.gustDuration -= deltaTime;
          this.turbulence *= 0.95;
        }
      }

      getWindAtAltitude(altitude) {
        const altitudeFactor = 1 + (altitude / 30) * this.windShear;
        const gustFactor = 1 + this.turbulence;
        const speed = this.baseSpeed * altitudeFactor * gustFactor;
        
        return {
          x: this.direction.x * speed,
          y: this.direction.y * speed,
          turbulence: this.turbulence
        };
      }

      getWindSpeed() {
        return this.baseSpeed * (1 + this.turbulence);
      }
    }

    // Cloud system with realistic growth
    class CloudSystem {
      constructor() {
        this.clouds = [];
        this.temperature = 20;
        this.humidity = 50;
        this.evaporationRate = 1.0;
        this.convectionStrength = 1.0;
      }

      determineCloudType() {
        const rand = Math.random();
        const humidity = this.humidity;
        const temp = this.temperature;
        
        // Low-level clouds (below 2km)
        if (humidity > 80 && rand > 0.92) return 'supercell';
        if (humidity > 75 && rand > 0.85) return 'cumulonimbus';
        if (humidity > 70 && rand > 0.75) return 'cumulus_congestus';
        if (humidity > 80 && rand > 0.65) return 'nimbostratus';
        if (humidity > 60 && rand > 0.6) return 'cumulus_mediocris';
        if (rand > 0.85) return 'stratocumulus';
        if (rand > 0.75) return 'cumulus_humilis';
        
        // Mid-level clouds (2-6km)
        if (rand > 0.65) return 'altocumulus';
        if (rand > 0.55) return 'altostratus';
        
        // High-level clouds (above 6km)
        if (temp < 15 && rand > 0.4) return 'cirrus';
        if (temp < 15 && rand > 0.3) return 'cirrocumulus';
        return 'cirrostratus';
      }

      createCloud() {
        const cloudType = this.determineCloudType();
        
        const cloudGroup = new THREE.Group();
        
        // Set altitude based on cloud type
        let baseAltitude = 5;
        if (cloudType === 'cirrus' || cloudType === 'cirrocumulus' || cloudType === 'cirrostratus') {
          baseAltitude = 25 + Math.random() * 10; // High clouds
        } else if (cloudType === 'altocumulus' || cloudType === 'altostratus') {
          baseAltitude = 12 + Math.random() * 8; // Mid-level clouds
        } else {
          baseAltitude = 3 + Math.random() * 12; // Low clouds
        }
        
        cloudGroup.position.x = (Math.random() - 0.5) * 80;
        cloudGroup.position.y = baseAltitude;
        cloudGroup.position.z = (Math.random() - 0.5) * 80;
        
        // Determine precipitation capability
        let canPrecipitate = false;
        let precipitationThreshold = 0.8;
        let alwaysPrecipitate = false;
        
        if (cloudType === 'supercell') {
          canPrecipitate = true;
          alwaysPrecipitate = true;
          precipitationThreshold = 0.3;
        } else if (cloudType === 'cumulonimbus') {
          canPrecipitate = true;
          alwaysPrecipitate = true;
          precipitationThreshold = 0.3;
        } else if (cloudType === 'cumulus_congestus') {
          canPrecipitate = true;
          alwaysPrecipitate = true;
          precipitationThreshold = 0.3;
        } else if (cloudType === 'altostratus') {
          canPrecipitate = true;
          alwaysPrecipitate = true;
          precipitationThreshold = 0.3;
        } else if (cloudType === 'nimbostratus') {
          canPrecipitate = true;
          precipitationThreshold = 0.5;
        } else if (cloudType === 'cumulus_mediocris' && Math.random() > 0.7) {
          canPrecipitate = true;
          precipitationThreshold = 0.8;
        } else if (cloudType === 'stratocumulus' && Math.random() > 0.8) {
          canPrecipitate = true;
          precipitationThreshold = 0.85;
        } else if (cloudType === 'altocumulus' && Math.random() > 0.85) {
          canPrecipitate = true;
          precipitationThreshold = 0.85;
        }
        
        cloudGroup.userData = {
          speed: 0.02 + Math.random() * 0.03,
          rotationSpeed: (Math.random() - 0.5) * 0.002,
          initialY: cloudGroup.position.y,
          floatSpeed: 0.3 + Math.random() * 0.2,
          age: 0,
          maxAge: 300 + Math.random() * 200,
          moisture: Math.random() * 0.3 + 0.2,
          growth: 0.5 + Math.random() * 0.5,
          stage: 'forming',
          baseScale: 1 + Math.random() * 0.8,
          precipitating: false,
          canPrecipitate,
          alwaysPrecipitate,
          precipitationThreshold,
          type: cloudType,
          structureElements: [],
          precipitationIntensity: 0,
          condensationLevel: 0,
          updraftStrength: 0.5 + Math.random() * 0.5,
          targetHeight: cloudGroup.position.y,
          verticalGrowth: 0,
          horizontalExpansion: 1
        };

        cloudGroup.scale.set(0.01, 0.01, 0.01);
        
        this.buildInitialStructure(cloudGroup, cloudType);
        
        scene.add(cloudGroup);
        this.clouds.push(cloudGroup);
        return cloudGroup;
      }

      buildInitialStructure(cloudGroup, type) {
        // Call appropriate builder based on type
        if (type === 'cirrus') {
          this.buildCirrus(cloudGroup);
        } else if (type === 'cirrocumulus') {
          this.buildCirrocumulus(cloudGroup);
        } else if (type === 'cirrostratus') {
          this.buildCirrostratus(cloudGroup);
        } else if (type === 'altocumulus') {
          this.buildAltocumulus(cloudGroup);
        } else if (type === 'altostratus') {
          this.buildAltostratus(cloudGroup);
        } else if (type === 'nimbostratus') {
          this.buildNimbostratus(cloudGroup);
        } else if (type === 'supercell') {
          this.buildSupercell(cloudGroup);
        } else {
          // For cumulus and stratocumulus, start with a small core
          const coreGeom = new THREE.SphereGeometry(3, 20, 20);
          const core = new THREE.Mesh(coreGeom, createCloudMaterial());
          core.userData.isCore = true;
          core.material.uniforms.density.value = 0.45;
          cloudGroup.add(core);
          cloudGroup.userData.structureElements.push(core);
          
          for (let i = 0; i < 3; i++) {
            const puffGeom = new THREE.SphereGeometry(2, 16, 16);
            const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
            puff.material.uniforms.density.value = 0.45;
            
            const angle = (i / 3) * Math.PI * 2;
            puff.position.set(
              Math.cos(angle) * 3,
              (Math.random() - 0.5) * 2,
              Math.sin(angle) * 3
            );
            
            puff.userData.layer = 0;
            puff.userData.birthTime = 0;
            
            cloudGroup.add(puff);
            cloudGroup.userData.structureElements.push(puff);
          }
        }
      }

      buildSupercell(cloudGroup) {
        // Massive rotating supercell with distinctive features
        const baseRadius = 18;
        const height = 35;
        
        // Main updraft column with rotation
        const columnLayers = 8;
        for (let layer = 0; layer < columnLayers; layer++) {
          const layerY = layer * 4.5;
          const rotationOffset = layer * 0.3; // Creates spiral
          const layerRadius = baseRadius * (1 - layer * 0.06);
          const puffsInLayer = 14;
          
          for (let i = 0; i < puffsInLayer; i++) {
            const angle = (i / puffsInLayer) * Math.PI * 2 + rotationOffset;
            const radius = layerRadius * (0.6 + Math.random() * 0.4);
            const size = 4.5 + Math.random() * 3;
            
            const puffGeom = new THREE.SphereGeometry(size, 16, 16);
            const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
            puff.material.uniforms.density.value = 0.55;
            
            puff.position.set(
              Math.cos(angle) * radius,
              layerY,
              Math.sin(angle) * radius
            );
            
            cloudGroup.add(puff);
            cloudGroup.userData.structureElements.push(puff);
          }
        }
        
        // Overshooting top
        for (let i = 0; i < 3; i++) {
          const topGeom = new THREE.SphereGeometry(7 - i * 1.5, 20, 20);
          const topPuff = new THREE.Mesh(topGeom, createCloudMaterial());
          topPuff.material.uniforms.density.value = 0.5;
          topPuff.position.y = height + i * 4;
          cloudGroup.add(topPuff);
          cloudGroup.userData.structureElements.push(topPuff);
        }
        
        // Anvil with asymmetric spread (downshear)
        const anvilY = height - 3;
        const anvilLayers = 4;
        
        for (let layer = 0; layer < anvilLayers; layer++) {
          const anvilRadius = 25 + layer * 8;
          const anvilPuffs = 16 + layer * 3;
          
          for (let i = 0; i < anvilPuffs; i++) {
            const angle = (i / anvilPuffs) * Math.PI * 2;
            // Asymmetric - extends more in one direction (downshear)
            const asymmetry = Math.cos(angle) * 0.4 + 1;
            const radius = anvilRadius * (0.7 + Math.random() * 0.3) * asymmetry;
            const size = 5 + Math.random() * 3;
            
            const puffGeom = new THREE.SphereGeometry(size, 16, 16);
            const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
            puff.material.uniforms.density.value = 0.4;
            
            puff.position.set(
              Math.cos(angle) * radius,
              anvilY + layer * 2,
              Math.sin(angle) * radius
            );
            
            puff.scale.set(1.6, 0.35, 1.6);
            
            cloudGroup.add(puff);
            cloudGroup.userData.structureElements.push(puff);
          }
        }
        
        // Mesocyclone (rotating core)
        for (let i = 0; i < 25; i++) {
          const coreHeight = Math.random() * height * 0.7;
          const coreAngle = (coreHeight / height) * Math.PI * 4; // Spiral
          const coreRadius = 8 + Math.random() * 6;
          
          const puffGeom = new THREE.SphereGeometry(3 + Math.random() * 2, 14, 14);
          const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
          puff.material.uniforms.density.value = 0.6;
          
          puff.position.set(
            Math.cos(coreAngle) * coreRadius,
            coreHeight,
            Math.sin(coreAngle) * coreRadius
          );
          
          cloudGroup.add(puff);
          cloudGroup.userData.structureElements.push(puff);
        }
        
        // Wall cloud (lowered base)
        const wallCloudPuffs = 10;
        for (let i = 0; i < wallCloudPuffs; i++) {
          const angle = (i / wallCloudPuffs) * Math.PI * 2;
          const radius = 10 + Math.random() * 4;
          const size = 4 + Math.random() * 2;
          
          const puffGeom = new THREE.SphereGeometry(size, 14, 14);
          const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
          puff.material.uniforms.density.value = 0.65;
          
          puff.position.set(
            Math.cos(angle) * radius,
            -3 + (Math.random() - 0.5) * 2,
            Math.sin(angle) * radius
          );
          
          puff.scale.set(1.2, 0.7, 1.2);
          
          cloudGroup.add(puff);
          cloudGroup.userData.structureElements.push(puff);
        }
      }

      growCloud(cloud, deltaTime) {
        const userData = cloud.userData;
        
        // High clouds (cirrus) don't grow from condensation
        if (userData.type.startsWith('cirro')) {
          if (this.humidity > 40 && this.temperature < 10) {
            userData.condensationLevel += deltaTime * 0.005 * this.evaporationRate;
          } else {
            userData.condensationLevel -= deltaTime * 0.008;
          }
          userData.condensationLevel = Math.max(0, Math.min(0.5, userData.condensationLevel));
          
          if (userData.condensationLevel > 0.2 && Math.random() < 0.008 * userData.condensationLevel) {
            this.addCloudPuff(cloud);
          }
          return;
        }
        
        // Higher evaporation rate = more moisture in atmosphere = faster cloud formation
        const formationBoost = this.evaporationRate;
        
        if (this.humidity > 60) {
          userData.condensationLevel += deltaTime * 0.01 * (this.humidity / 100) * formationBoost;
        } else {
          userData.condensationLevel -= deltaTime * 0.005;
        }
        userData.condensationLevel = Math.max(0, Math.min(1, userData.condensationLevel));
        
        // Different growth rates for different cloud types
        let growthChance = 0.02 * userData.condensationLevel * formationBoost;
        
        if (userData.type === 'nimbostratus') {
          growthChance *= 1.5; // Nimbostratus grows extensively
        } else if (userData.type.startsWith('alto')) {
          growthChance *= 0.8; // Mid-level clouds grow moderately
        }
        
        if (userData.condensationLevel > 0.3 && Math.random() < growthChance) {
          this.addCloudPuff(cloud);
        }
        
        // Vertical growth for convective clouds
        if ((userData.type === 'cumulus_congestus' || userData.type === 'cumulonimbus') && 
            userData.condensationLevel > 0.5) {
          userData.verticalGrowth += deltaTime * 0.5 * userData.updraftStrength * this.convectionStrength;
          userData.targetHeight = userData.initialY + userData.verticalGrowth;
        }
        
        // Horizontal expansion varies by type
        let expansionRate = 0.1;
        if (userData.type === 'nimbostratus' || userData.type.startsWith('alto')) {
          expansionRate = 0.15; // Layer clouds expand more horizontally
        } else if (userData.type.startsWith('cirro')) {
          expansionRate = 0.12;
        }
        
        userData.horizontalExpansion += deltaTime * expansionRate * userData.condensationLevel;
      }

      addCloudPuff(cloud) {
        const userData = cloud.userData;
        
        if (userData.structureElements.length > 100) return;
        
        let pos = new THREE.Vector3();
        
        if (userData.type === 'cumulonimbus' || userData.type === 'cumulus_congestus') {
          if (Math.random() > 0.4) {
            pos.y = userData.verticalGrowth * 0.5 + (Math.random() - 0.5) * 5;
            const angle = Math.random() * Math.PI * 2;
            const radius = 5 + Math.random() * 8;
            pos.x = Math.cos(angle) * radius;
            pos.z = Math.sin(angle) * radius;
          } else {
            pos.y = userData.verticalGrowth * 0.8;
            const angle = Math.random() * Math.PI * 2;
            const radius = 10 + Math.random() * 15;
            pos.x = Math.cos(angle) * radius;
            pos.z = Math.sin(angle) * radius;
          }
        } else if (userData.type === 'supercell') {
          // Supercell growth - emphasize rotation and asymmetry
          const growthAngle = Math.random() * Math.PI * 2 + userData.age * 0.3;
          if (Math.random() > 0.3) {
            // Vertical column growth
            pos.y = Math.random() * userData.verticalGrowth * 0.8;
            const radius = 8 + Math.random() * 10;
            pos.x = Math.cos(growthAngle) * radius;
            pos.z = Math.sin(growthAngle) * radius;
          } else {
            // Anvil/outflow expansion (asymmetric)
            pos.y = userData.verticalGrowth * 0.85 + (Math.random() - 0.5) * 3;
            const asymmetry = Math.cos(growthAngle) * 0.5 + 1;
            const radius = 15 + Math.random() * 20;
            pos.x = Math.cos(growthAngle) * radius * asymmetry;
            pos.z = Math.sin(growthAngle) * radius;
          }
        } else if (userData.type === 'stratocumulus' || userData.type === 'nimbostratus') {
          pos.x = (Math.random() - 0.5) * 20;
          pos.y = (Math.random() - 0.5) * 3;
          pos.z = (Math.random() - 0.5) * 18;
        } else if (userData.type === 'altocumulus') {
          const angle = Math.random() * Math.PI * 2;
          const radius = 6 + Math.random() * 10;
          pos.x = Math.cos(angle) * radius;
          pos.y = (Math.random() - 0.5) * 4;
          pos.z = Math.sin(angle) * radius;
        } else if (userData.type === 'altostratus') {
          pos.x = (Math.random() - 0.5) * 25;
          pos.y = (Math.random() - 0.5) * 2;
          pos.z = (Math.random() - 0.5) * 22;
        } else if (userData.type === 'cirrus') {
          // Wispy streaks
          pos.x = (Math.random() - 0.5) * 30 + userData.horizontalExpansion * 5;
          pos.y = (Math.random() - 0.5) * 2;
          pos.z = (Math.random() - 0.5) * 8;
        } else if (userData.type === 'cirrocumulus') {
          const angle = Math.random() * Math.PI * 2;
          const radius = 3 + Math.random() * 6;
          pos.x = Math.cos(angle) * radius;
          pos.y = (Math.random() - 0.5) * 1;
          pos.z = Math.sin(angle) * radius;
        } else if (userData.type === 'cirrostratus') {
          pos.x = (Math.random() - 0.5) * 35;
          pos.y = (Math.random() - 0.5) * 1.5;
          pos.z = (Math.random() - 0.5) * 30;
        } else {
          const angle = Math.random() * Math.PI * 2;
          const radius = 4 + Math.random() * 8;
          pos.x = Math.cos(angle) * radius;
          pos.y = Math.random() * 10 - 2;
          pos.z = Math.sin(angle) * radius;
        }
        
        const size = 2.5 + Math.random() * 2.5;
        const puffGeom = new THREE.SphereGeometry(size, 16, 16);
        const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
        
        // Adjust density for cloud type
        if (userData.type.startsWith('cirro')) {
          puff.material.uniforms.density.value = 0.15; // Very thin
        } else if (userData.type.startsWith('alto')) {
          puff.material.uniforms.density.value = 0.3; // Medium
        } else if (userData.type === 'nimbostratus') {
          puff.material.uniforms.density.value = 0.6; // Very thick
        } else {
          puff.material.uniforms.density.value = 0.45;
        }
        
        puff.position.copy(pos);
        puff.userData.birthTime = userData.age;
        
        // Shape modifications
        if (userData.type === 'stratocumulus' || userData.type === 'altostratus' || userData.type === 'nimbostratus') {
          puff.scale.set(1.5, 0.5, 1.2);
        } else if (userData.type === 'cirrus') {
          puff.scale.set(3, 0.3, 0.5); // Long thin streaks
        } else if (userData.type === 'cirrostratus') {
          puff.scale.set(2, 0.2, 1.8); // Thin sheets
        } else if (userData.type === 'cirrocumulus') {
          puff.scale.set(0.6, 0.5, 0.6); // Small puffs
        }
        
        cloud.add(puff);
        userData.structureElements.push(puff);
      }

      buildCirrus(cloudGroup) {
        // Wispy, fibrous high clouds
        const streaks = 3 + Math.floor(Math.random() * 3);
        
        for (let streak = 0; streak < streaks; streak++) {
          const startX = (Math.random() - 0.5) * 10;
          const startZ = (Math.random() - 0.5) * 10;
          const angle = Math.random() * Math.PI * 2;
          
          const segments = 8 + Math.floor(Math.random() * 6);
          
          for (let i = 0; i < segments; i++) {
            const progress = i / segments;
            const size = 1.5 + Math.random() * 1 - progress * 0.5;
            
            const puffGeom = new THREE.SphereGeometry(size, 12, 12);
            const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
            puff.material.uniforms.density.value = 0.15;
            
            puff.position.set(
              startX + Math.cos(angle) * i * 3 + (Math.random() - 0.5) * 2,
              (Math.random() - 0.5) * 1,
              startZ + Math.sin(angle) * i * 3 + (Math.random() - 0.5) * 2
            );
            
            puff.scale.set(3, 0.3, 0.5);
            puff.rotation.y = angle + (Math.random() - 0.5) * 0.5;
            
            cloudGroup.add(puff);
            cloudGroup.userData.structureElements.push(puff);
          }
        }
      }

      buildCirrocumulus(cloudGroup) {
        // Small, white patches in rows
        const rows = 3;
        const puffsPerRow = 8;
        
        for (let row = 0; row < rows; row++) {
          const rowZ = (row - 1) * 4;
          
          for (let i = 0; i < puffsPerRow; i++) {
            const size = 1 + Math.random() * 0.8;
            const puffGeom = new THREE.SphereGeometry(size, 12, 12);
            const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
            puff.material.uniforms.density.value = 0.2;
            
            puff.position.set(
              (i - puffsPerRow / 2) * 2.5 + (Math.random() - 0.5),
              (Math.random() - 0.5) * 0.5,
              rowZ + (Math.random() - 0.5)
            );
            
            puff.scale.set(0.7, 0.6, 0.7);
            
            cloudGroup.add(puff);
            cloudGroup.userData.structureElements.push(puff);
          }
        }
      }

      buildCirrostratus(cloudGroup) {
        // Thin, uniform ice crystal sheet
        const width = 30;
        const depth = 25;
        
        for (let x = 0; x < 6; x++) {
          for (let z = 0; z < 5; z++) {
            const size = 3 + Math.random() * 2;
            const puffGeom = new THREE.SphereGeometry(size, 12, 12);
            const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
            puff.material.uniforms.density.value = 0.18;
            
            puff.position.set(
              (x / 5 - 0.5) * width + (Math.random() - 0.5) * 4,
              (Math.random() - 0.5) * 0.8,
              (z / 4 - 0.5) * depth + (Math.random() - 0.5) * 3
            );
            
            puff.scale.set(2, 0.2, 1.8);
            
            cloudGroup.add(puff);
            cloudGroup.userData.structureElements.push(puff);
          }
        }
      }

      buildAltocumulus(cloudGroup) {
        // Mid-level patches or rolls
        const patches = 4 + Math.floor(Math.random() * 3);
        
        for (let patch = 0; patch < patches; patch++) {
          const centerAngle = (patch / patches) * Math.PI * 2;
          const radius = 8 + Math.random() * 4;
          const centerX = Math.cos(centerAngle) * radius;
          const centerZ = Math.sin(centerAngle) * radius;
          
          const puffsInPatch = 5 + Math.floor(Math.random() * 4);
          
          for (let i = 0; i < puffsInPatch; i++) {
            const size = 2.5 + Math.random() * 2;
            const puffGeom = new THREE.SphereGeometry(size, 14, 14);
            const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
            puff.material.uniforms.density.value = 0.35;
            
            puff.position.set(
              centerX + (Math.random() - 0.5) * 6,
              (Math.random() - 0.5) * 3,
              centerZ + (Math.random() - 0.5) * 6
            );
            
            puff.scale.set(1.2, 0.8, 1.2);
            
            cloudGroup.add(puff);
            cloudGroup.userData.structureElements.push(puff);
          }
        }
      }

      buildAltostratus(cloudGroup) {
        // Uniform gray sheet
        const width = 28;
        const depth = 24;
        
        for (let x = 0; x < 7; x++) {
          for (let z = 0; z < 6; z++) {
            const size = 3.5 + Math.random() * 2;
            const puffGeom = new THREE.SphereGeometry(size, 14, 14);
            const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
            puff.material.uniforms.density.value = 0.4;
            
            puff.position.set(
              (x / 6 - 0.5) * width + (Math.random() - 0.5) * 3,
              (Math.random() - 0.5) * 2,
              (z / 5 - 0.5) * depth + (Math.random() - 0.5) * 3
            );
            
            puff.scale.set(1.8, 0.5, 1.6);
            
            cloudGroup.add(puff);
            cloudGroup.userData.structureElements.push(puff);
          }
        }
      }

      buildNimbostratus(cloudGroup) {
        // Thick, dark, uniform rain cloud
        const width = 30;
        const depth = 26;
        const height = 8;
        
        // Build thick layered structure
        for (let layer = 0; layer < 3; layer++) {
          const layerY = layer * 3;
          
          for (let x = 0; x < 8; x++) {
            for (let z = 0; z < 7; z++) {
              const size = 3 + Math.random() * 2.5;
              const puffGeom = new THREE.SphereGeometry(size, 14, 14);
              const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
              puff.material.uniforms.density.value = 0.6;
              
              puff.position.set(
                (x / 7 - 0.5) * width + (Math.random() - 0.5) * 2,
                layerY + (Math.random() - 0.5) * 1.5,
                (z / 6 - 0.5) * depth + (Math.random() - 0.5) * 2
              );
              
              puff.scale.set(1.6, 0.6, 1.5);
              
              cloudGroup.add(puff);
              cloudGroup.userData.structureElements.push(puff);
            }
          }
        }
      }

      updateCloud(cloud, deltaTime, windSystem) {
        const userData = cloud.userData;
        userData.age += deltaTime;
        const lifeRatio = userData.age / userData.maxAge;

        if (lifeRatio < 0.15) {
          userData.stage = 'forming';
          const formScale = (lifeRatio / 0.15);
          cloud.scale.set(
            formScale * 0.3,
            formScale * 0.3,
            formScale * 0.3
          );
        } else if (lifeRatio < 0.25) {
          userData.stage = 'developing';
          this.growCloud(cloud, deltaTime);
          
          const devScale = 0.3 + ((lifeRatio - 0.15) / 0.1) * 0.7;
          cloud.scale.set(
            devScale * userData.baseScale * userData.horizontalExpansion,
            devScale * userData.baseScale * (1 + userData.verticalGrowth * 0.1),
            devScale * userData.baseScale * userData.horizontalExpansion
          );
          
        } else if (lifeRatio < 0.7) {
          userData.stage = 'mature';
          
          this.growCloud(cloud, deltaTime);
          
          cloud.scale.set(
            userData.baseScale * userData.horizontalExpansion,
            userData.baseScale * (1 + userData.verticalGrowth * 0.1),
            userData.baseScale * userData.horizontalExpansion
          );
          
          userData.structureElements.forEach((element, idx) => {
            if (!element.userData.isCore) {
              const phase = userData.age * 0.5 + idx;
              element.position.y += Math.sin(phase) * 0.015 * deltaTime;
              
              if (userData.updraftStrength > 0.6 && element.position.y < userData.verticalGrowth * 0.5) {
                element.position.y += deltaTime * 0.3 * userData.updraftStrength;
              }
            }
          });
          
          userData.moisture += deltaTime * 0.001 * userData.condensationLevel;
          userData.moisture = Math.min(1, userData.moisture);
          
          if (userData.canPrecipitate && 
              userData.moisture > userData.precipitationThreshold && 
              this.humidity > 60) {
            userData.precipitating = true;
            userData.precipitationIntensity = 
              (userData.moisture - userData.precipitationThreshold) / 
              (1 - userData.precipitationThreshold);
            
            // Clouds lose moisture slower now since evaporation feeds formation
            userData.moisture += deltaTime * 0.0005 - 
              deltaTime * 0.001 * userData.precipitationIntensity;
          } else {
            userData.precipitating = false;
            userData.precipitationIntensity = 0;
          }
          
        } else {
          userData.stage = 'dissipating';
          const dissipate = 1 - ((lifeRatio - 0.7) / 0.3);
          
          userData.structureElements.forEach(element => {
            element.material.uniforms.density.value = 0.45 * dissipate;
          });
          
          userData.precipitating = false;
          userData.condensationLevel *= 0.98;
        }

        if (this.humidity > 70) {
          userData.moisture = Math.min(1, 
            userData.moisture + deltaTime * 0.002);
        } else if (this.humidity < 40) {
          userData.moisture = Math.max(0.2, 
            userData.moisture - deltaTime * 0.001);
        }

        userData.structureElements.forEach(element => {
          element.material.uniforms.moisture.value = userData.moisture;
        });

        const wind = windSystem.getWindAtAltitude(cloud.position.y);
        cloud.position.x += wind.x * controls.windSpeed;
        cloud.position.z += wind.y * controls.windSpeed;
        
        const windDeform = wind.turbulence * 0.1;
        cloud.rotation.z = windDeform;

        if (lifeRatio >= 1) {
          return true;
        }

        return false;
      }

      update(deltaTime, windSystem) {
        // No max clouds limit - formation based on humidity and evaporation rate
        const formationRate = this.humidity * this.evaporationRate / 5000;
        if (Math.random() < formationRate) {
          this.createCloud();
        }

        for (let i = this.clouds.length - 1; i >= 0; i--) {
          const cloud = this.clouds[i];
          
          if (cloud.position.x > 100) cloud.position.x = -100;
          if (cloud.position.x < -100) cloud.position.x = 100;
          if (cloud.position.z > 100) cloud.position.z = -100;
          if (cloud.position.z < -100) cloud.position.z = 100;
          
          const shouldRemove = this.updateCloud(cloud, deltaTime, windSystem);
          
          if (shouldRemove) {
            scene.remove(cloud);
            cloud.userData.structureElements.forEach(element => {
              element.geometry.dispose();
              element.material.dispose();
            });
            this.clouds.splice(i, 1);
          }
        }
      }

      getPrecipitatingClouds() {
        return this.clouds.filter(c => c.userData.precipitating);
      }
    }

    // Complex precipitation system with varied effects
    class PrecipitationSystem {
      constructor() {
        this.rainSystems = new Map();
        this.maxParticlesPerCloud = 800;
        this.splashParticles = [];
        this.splashGeometry = new THREE.BufferGeometry();
        const splashPositions = new Float32Array(500 * 3);
        const splashVelocities = new Float32Array(500 * 3);
        const splashLifetimes = new Float32Array(500);
        
        this.splashGeometry.setAttribute('position', new THREE.BufferAttribute(splashPositions, 3));
        this.splashGeometry.setAttribute('velocity', new THREE.BufferAttribute(splashVelocities, 3));
        this.splashGeometry.setAttribute('lifetime', new THREE.BufferAttribute(splashLifetimes, 1));
        
        const splashMaterial = new THREE.PointsMaterial({
          color: 0x88ccee,
          size: 0.2,
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending
        });
        
        this.splashSystem = new THREE.Points(this.splashGeometry, splashMaterial);
        scene.add(this.splashSystem);
        this.activeSplashes = 0;
      }

      getOrCreateRainSystem(cloud) {
        if (!this.rainSystems.has(cloud)) {
          const geometry = new THREE.BufferGeometry();
          const positions = new Float32Array(this.maxParticlesPerCloud * 3);
          const velocities = new Float32Array(this.maxParticlesPerCloud);
          const sizes = new Float32Array(this.maxParticlesPerCloud);
          
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 1));
          geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
          
          const material = new THREE.ShaderMaterial({
            uniforms: {
              baseSize: { value: 0.3 }
            },
            vertexShader: `
              attribute float size;
              varying float vSize;
              
              void main() {
                vSize = size;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * (300.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
              }
            `,
            fragmentShader: `
              varying float vSize;
              
              void main() {
                vec2 center = gl_PointCoord - vec2(0.5);
                float dist = length(center);
                
                if (dist > 0.5) discard;
                
                float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
                alpha *= 0.6;
                
                vec3 color = vec3(0.6, 0.75, 0.85);
                if (vSize > 0.5) {
                  color = vec3(0.7, 0.8, 0.9);
                }
                
                gl_FragColor = vec4(color, alpha);
              }
            `,
            transparent: true,
            blending: THREE.NormalBlending,
            depthWrite: false
          });
          
          const system = new THREE.Points(geometry, material);
          scene.add(system);
          
          this.rainSystems.set(cloud, {
            system,
            geometry,
            material,
            activeParticles: 0
          });
        }
        
        return this.rainSystems.get(cloud);
      }

      createSplash(x, z, intensity) {
        if (this.activeSplashes >= 500) return;
        
        const positions = this.splashGeometry.attributes.position.array;
        const velocities = this.splashGeometry.attributes.velocity.array;
        const lifetimes = this.splashGeometry.attributes.lifetime.array;
        
        const count = Math.floor(2 + intensity * 4);
        
        for (let i = 0; i < count && this.activeSplashes < 500; i++) {
          const idx = this.activeSplashes * 3;
          
          positions[idx] = x;
          positions[idx + 1] = 0.1;
          positions[idx + 2] = z;
          
          const angle = Math.random() * Math.PI * 2;
          const speed = 0.3 + Math.random() * 0.5;
          
          velocities[idx] = Math.cos(angle) * speed;
          velocities[idx + 1] = 0.5 + Math.random() * 0.8;
          velocities[idx + 2] = Math.sin(angle) * speed;
          
          lifetimes[this.activeSplashes] = 0.5 + Math.random() * 0.3;
          
          this.activeSplashes++;
        }
      }

      updateSplashes(deltaTime) {
        const positions = this.splashGeometry.attributes.position.array;
        const velocities = this.splashGeometry.attributes.velocity.array;
        const lifetimes = this.splashGeometry.attributes.lifetime.array;
        
        let writeIdx = 0;
        
        for (let i = 0; i < this.activeSplashes; i++) {
          const idx = i * 3;
          
          positions[idx] += velocities[idx] * deltaTime * 10;
          positions[idx + 1] += velocities[idx + 1] * deltaTime * 10;
          positions[idx + 2] += velocities[idx + 2] * deltaTime * 10;
          
          velocities[idx + 1] -= deltaTime * 2;
          
          lifetimes[i] -= deltaTime;
          
          if (lifetimes[i] > 0 && positions[idx + 1] > 0) {
            if (writeIdx !== i) {
              positions[writeIdx * 3] = positions[idx];
              positions[writeIdx * 3 + 1] = positions[idx + 1];
              positions[writeIdx * 3 + 2] = positions[idx + 2];
              
              velocities[writeIdx * 3] = velocities[idx];
              velocities[writeIdx * 3 + 1] = velocities[idx + 1];
              velocities[writeIdx * 3 + 2] = velocities[idx + 2];
              
              lifetimes[writeIdx] = lifetimes[i];
            }
            writeIdx++;
          }
        }
        
        this.activeSplashes = writeIdx;
        
        this.splashGeometry.attributes.position.needsUpdate = true;
        this.splashGeometry.attributes.velocity.needsUpdate = true;
        this.splashGeometry.attributes.lifetime.needsUpdate = true;
        this.splashGeometry.setDrawRange(0, this.activeSplashes);
      }

      update(precipitatingClouds, windSystem, deltaTime) {
        for (const [cloud, rainData] of this.rainSystems.entries()) {
          if (!precipitatingClouds.includes(cloud)) {
            scene.remove(rainData.system);
            rainData.geometry.dispose();
            rainData.material.dispose();
            this.rainSystems.delete(cloud);
          }
        }

        precipitatingClouds.forEach(cloud => {
          const rainData = this.getOrCreateRainSystem(cloud);
          const positions = rainData.geometry.attributes.position.array;
          const velocities = rainData.geometry.attributes.velocity.array;
          const sizes = rainData.geometry.attributes.size.array;
          
          const intensity = cloud.userData.precipitationIntensity;
          
          // Determine precipitation type based on cloud type and intensity
          let particleSize, fallSpeed, spawnRate;
          
          if (cloud.userData.type === 'stratocumulus' || cloud.userData.type === 'altocumulus') {
            // Very light sprinkle/drizzle
            particleSize = 0.12 + Math.random() * 0.08;
            fallSpeed = -0.2 - Math.random() * 0.15;
            spawnRate = Math.floor(intensity * 8);
          } else if (cloud.userData.type === 'altostratus') {
            // Light rain
            particleSize = 0.18 + Math.random() * 0.1;
            fallSpeed = -0.35 - Math.random() * 0.2;
            spawnRate = Math.floor(intensity * 12);
          } else if (cloud.userData.type === 'nimbostratus') {
            // Steady moderate to heavy rain
            particleSize = 0.3 + Math.random() * 0.2;
            fallSpeed = -0.7 - Math.random() * 0.3;
            spawnRate = Math.floor(20 + intensity * 15);
          } else if (intensity < 0.3) {
            // Drizzle from cumulus
            particleSize = 0.15 + Math.random() * 0.1;
            fallSpeed = -0.3 - Math.random() * 0.2;
            spawnRate = Math.floor(intensity * 15);
          } else if (intensity < 0.6) {
            // Moderate rain
            particleSize = 0.25 + Math.random() * 0.15;
            fallSpeed = -0.6 - Math.random() * 0.3;
            spawnRate = Math.floor(intensity * 20);
          } else if (intensity < 0.85) {
            // Heavy rain
            particleSize = 0.35 + Math.random() * 0.2;
            fallSpeed = -0.9 - Math.random() * 0.4;
            spawnRate = Math.floor(intensity * 25);
          } else {
            // Torrential / Hail (for cumulonimbus)
            if (cloud.userData.type === 'cumulonimbus' && Math.random() > 0.7) {
              particleSize = 0.6 + Math.random() * 0.4;
              fallSpeed = -1.2 - Math.random() * 0.5;
            } else {
              particleSize = 0.4 + Math.random() * 0.3;
              fallSpeed = -1.0 - Math.random() * 0.5;
            }
            spawnRate = Math.floor(intensity * 30);
          }
          
          const wind = windSystem.getWindAtAltitude(cloud.position.y - 5);
          
          for (let i = 0; i < spawnRate; i++) {
            if (rainData.activeParticles < this.maxParticlesPerCloud && Math.random() < 0.5) {
              const idx = rainData.activeParticles * 3;
              
              const cloudPos = new THREE.Vector3();
              cloud.getWorldPosition(cloudPos);
              
              const spread = 12 * cloud.scale.x;
              
              positions[idx] = cloudPos.x + (Math.random() - 0.5) * spread;
              positions[idx + 1] = cloudPos.y - 2 + (Math.random() - 0.5) * 6;
              positions[idx + 2] = cloudPos.z + (Math.random() - 0.5) * spread;
              
              velocities[rainData.activeParticles] = fallSpeed;
              sizes[rainData.activeParticles] = particleSize;
              
              rainData.activeParticles++;
            }
          }
          
          let writeIdx = 0;
          for (let i = 0; i < rainData.activeParticles; i++) {
            const idx = i * 3;
            positions[idx + 1] += velocities[i];
            
            const altitude = positions[idx + 1];
            const windAtAlt = windSystem.getWindAtAltitude(altitude);
            const windInfluence = Math.max(0, altitude / 30);
            
            positions[idx] += windAtAlt.x * 0.8 * windInfluence;
            positions[idx + 2] += windAtAlt.y * 0.8 * windInfluence;
            
            if (positions[idx + 1] > 0.2) {
              if (writeIdx !== i) {
                positions[writeIdx * 3] = positions[idx];
                positions[writeIdx * 3 + 1] = positions[idx + 1];
                positions[writeIdx * 3 + 2] = positions[idx + 2];
                velocities[writeIdx] = velocities[i];
                sizes[writeIdx] = sizes[i];
              }
              writeIdx++;
            } else if (positions[idx + 1] <= 0.2 && positions[idx + 1] > -0.5) {
              // Create splash
              if (Math.random() < 0.3) {
                this.createSplash(positions[idx], positions[idx + 2], intensity);
              }
            }
          }
          
          rainData.activeParticles = writeIdx;
          
          rainData.geometry.attributes.position.needsUpdate = true;
          rainData.geometry.attributes.velocity.needsUpdate = true;
          rainData.geometry.attributes.size.needsUpdate = true;
          rainData.geometry.setDrawRange(0, rainData.activeParticles);
        });
        
        this.updateSplashes(deltaTime);
      }

      cleanup() {
        for (const [cloud, rainData] of this.rainSystems.entries()) {
          scene.remove(rainData.system);
          rainData.geometry.dispose();
          rainData.material.dispose();
        }
        this.rainSystems.clear();
        scene.remove(this.splashSystem);
        this.splashGeometry.dispose();
        this.splashSystem.material.dispose();
      }
    }

    // Lightning system
    class LightningSystem {
      constructor() {
        this.flashLights = [];
        this.activeBolts = [];
        this.shakeIntensity = 0;
        this.shakeDecay = 0.9;
        
        for (let i = 0; i < 3; i++) {
          const light = new THREE.PointLight(0xaaccff, 0, 100);
          scene.add(light);
          this.flashLights.push(light);
        }
      }

      createBranch(start, end, depth = 0, maxDepth = 3) {
        const points = [start.clone()];
        const steps = 8 - depth * 2;
        
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const point = new THREE.Vector3().lerpVectors(start, end, t);
          
          point.x += (Math.random() - 0.5) * (3 - depth);
          point.z += (Math.random() - 0.5) * (3 - depth);
          
          points.push(point);
          
          if (depth < maxDepth && Math.random() < 0.3 - depth * 0.1) {
            const branchEnd = point.clone();
            branchEnd.x += (Math.random() - 0.5) * 15;
            branchEnd.y -= Math.random() * 8;
            branchEnd.z += (Math.random() - 0.5) * 15;
            
            const subBranch = this.createBranch(point, branchEnd, depth + 1, maxDepth);
            points.push(...subBranch);
          }
        }
        
        return points;
      }

      trigger(cloud) {
        const cloudPos = new THREE.Vector3();
        cloud.getWorldPosition(cloudPos);
        
        this.flashLights.forEach((light, i) => {
          light.position.set(
            cloudPos.x + (Math.random() - 0.5) * 20,
            cloudPos.y,
            cloudPos.z + (Math.random() - 0.5) * 20
          );
          light.intensity = 6 + Math.random() * 4;
        });
        
        const groundPos = cloudPos.clone();
        groundPos.y = 0;
        
        const mainPoints = this.createBranch(cloudPos, groundPos, 0, 3);
        
        const geometry = new THREE.BufferGeometry().setFromPoints(mainPoints);
        const material = new THREE.LineBasicMaterial({ 
          color: 0xffffff, 
          opacity: 0.9, 
          transparent: true,
          linewidth: 2
        });
        const bolt = new THREE.Line(geometry, material);
        
        scene.add(bolt);
        this.activeBolts.push({ bolt, age: 0 });
        
        this.shakeIntensity = 2.5;
        
        scene.background = new THREE.Color(0xFFFFFF);
        setTimeout(() => {
          scene.background = new THREE.Color(0x87CEEB);
        }, 50);
        
        setTimeout(() => {
          this.flashLights.forEach(light => {
            light.intensity = 0;
          });
        }, 150);
      }

      update(stormClouds, deltaTime) {
        if (this.shakeIntensity > 0.01) {
          camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
          camera.position.y += (Math.random() - 0.5) * this.shakeIntensity;
          this.shakeIntensity *= this.shakeDecay;
        }
        
        stormClouds.forEach(cloud => {
          const stormPotential = cloud.userData.moisture * cloud.userData.precipitationIntensity;
          
          if (cloud.userData.type === 'cumulonimbus' && stormPotential > 0.7) {
            if (Math.random() < 0.003) {
              this.trigger(cloud);
            }
          } else if (cloud.userData.type === 'cumulus_congestus' && stormPotential > 0.8) {
            if (Math.random() < 0.001) {
              this.trigger(cloud);
            }
          }
        });
        
        for (let i = this.activeBolts.length - 1; i >= 0; i--) {
          const boltData = this.activeBolts[i];
          boltData.age += deltaTime;
          
          if (boltData.age > 0.2) {
            scene.remove(boltData.bolt);
            boltData.bolt.geometry.dispose();
            boltData.bolt.material.dispose();
            this.activeBolts.splice(i, 1);
          } else {
            boltData.bolt.material.opacity = 0.9 * (1 - boltData.age / 0.2);
          }
        }
      }

      cleanup() {
        this.flashLights.forEach(light => {
          scene.remove(light);
        });
        this.activeBolts.forEach(boltData => {
          scene.remove(boltData.bolt);
          boltData.bolt.geometry.dispose();
          boltData.bolt.material.dispose();
        });
      }
    }

    // Camera controls with mobile support
    class CameraController {
      constructor(camera) {
        this.camera = camera;
        this.moveSpeed = 0.5;
        this.lookSpeed = 0.003;
        
        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;
        this.moveUp = false;
        this.moveDown = false;
        
        this.yaw = 0;
        this.pitch = 0;
        
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        
        // Mobile controls
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.joystickActive = false;
        this.joystickDeltaX = 0;
        this.joystickDeltaY = 0;
        
        this.setupControls();
      }

      setupControls() {
        // Keyboard
        document.addEventListener('keydown', (e) => {
          switch(e.key.toLowerCase()) {
            case 'w': case 'arrowup': this.moveForward = true; break;
            case 's': case 'arrowdown': this.moveBackward = true; break;
            case 'a': case 'arrowleft': this.moveLeft = true; break;
            case 'd': case 'arrowright': this.moveRight = true; break;
            case 'q': this.moveDown = true; break;
            case 'e': this.moveUp = true; break;
          }
        });

        document.addEventListener('keyup', (e) => {
          switch(e.key.toLowerCase()) {
            case 'w': case 'arrowup': this.moveForward = false; break;
            case 's': case 'arrowdown': this.moveBackward = false; break;
            case 'a': case 'arrowleft': this.moveLeft = false; break;
            case 'd': case 'arrowright': this.moveRight = false; break;
            case 'q': this.moveDown = false; break;
            case 'e': this.moveUp = false; break;
          }
        });

        // Mouse
        document.addEventListener('mousedown', (e) => {
          if (e.button === 0) {
            this.isDragging = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
          }
        });

        document.addEventListener('mouseup', () => {
          this.isDragging = false;
        });

        document.addEventListener('mousemove', (e) => {
          if (this.isDragging) {
            const deltaX = e.clientX - this.lastMouseX;
            const deltaY = e.clientY - this.lastMouseY;
            
            this.yaw -= deltaX * this.lookSpeed;
            this.pitch -= deltaY * this.lookSpeed;
            
            this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));
            
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
          }
        });

        // Touch controls
        if (this.isMobile) {
          document.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
              const touch = e.touches[0];
              if (touch.clientX < window.innerWidth / 3) {
                // Left side - movement joystick
                this.joystickActive = true;
                this.touchStartX = touch.clientX;
                this.touchStartY = touch.clientY;
              } else {
                // Right side - look around
                this.isDragging = true;
                this.lastMouseX = touch.clientX;
                this.lastMouseY = touch.clientY;
              }
            }
          });

          document.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length === 1) {
              const touch = e.touches[0];
              
              if (this.joystickActive) {
                this.joystickDeltaX = (touch.clientX - this.touchStartX) / 50;
                this.joystickDeltaY = (touch.clientY - this.touchStartY) / 50;
              } else if (this.isDragging) {
                const deltaX = touch.clientX - this.lastMouseX;
                const deltaY = touch.clientY - this.lastMouseY;
                
                this.yaw -= deltaX * this.lookSpeed * 2;
                this.pitch -= deltaY * this.lookSpeed * 2;
                
                this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));
                
                this.lastMouseX = touch.clientX;
                this.lastMouseY = touch.clientY;
              }
            }
          }, { passive: false });

          document.addEventListener('touchend', () => {
            this.isDragging = false;
            this.joystickActive = false;
            this.joystickDeltaX = 0;
            this.joystickDeltaY = 0;
          });
        }
      }

      update() {
        const forward = new THREE.Vector3(
          Math.sin(this.yaw),
          0,
          Math.cos(this.yaw)
        );
        
        const right = new THREE.Vector3(
          Math.cos(this.yaw),
          0,
          -Math.sin(this.yaw)
        );

        // Keyboard/regular controls
        if (this.moveForward) this.camera.position.addScaledVector(forward, this.moveSpeed);
        if (this.moveBackward) this.camera.position.addScaledVector(forward, -this.moveSpeed);
        if (this.moveRight) this.camera.position.addScaledVector(right, this.moveSpeed);
        if (this.moveLeft) this.camera.position.addScaledVector(right, -this.moveSpeed);
        
        // Limited vertical movement - stay near ground
        if (this.moveUp && this.camera.position.y < 5) this.camera.position.y += this.moveSpeed * 0.5;
        if (this.moveDown && this.camera.position.y > 0.5) this.camera.position.y -= this.moveSpeed * 0.5;
        
        // Clamp camera to surface level
        this.camera.position.y = Math.max(0.5, Math.min(5, this.camera.position.y));

        // Mobile joystick
        if (this.joystickActive) {
          this.camera.position.addScaledVector(forward, -this.joystickDeltaY * this.moveSpeed);
          this.camera.position.addScaledVector(right, this.joystickDeltaX * this.moveSpeed);
        }

        const lookDirection = new THREE.Vector3(
          Math.sin(this.yaw) * Math.cos(this.pitch),
          Math.sin(this.pitch),
          Math.cos(this.yaw) * Math.cos(this.pitch)
        );
        
        const lookAt = this.camera.position.clone().add(lookDirection);
        this.camera.lookAt(lookAt);
      }
    }

    const windSystem = new WindSystem();
    const cloudSystem = new CloudSystem();
    const precipSystem = new PrecipitationSystem();
    const lightningSystem = new LightningSystem();
    const cameraController = new CameraController(camera);

    for (let i = 0; i < 10; i++) {
      cloudSystem.createCloud();
    }

    // Ground
    const groundGeometry = new THREE.PlaneGeometry(500, 500);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x5a8a3a,
      roughness: 0.9
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    // Animation loop
    let time = 0;
    let lastTime = Date.now();

    const animate = () => {
      requestAnimationFrame(animate);
      
      const now = Date.now();
      const deltaTime = ((now - lastTime) / 1000) * controls.simulationSpeed;
      lastTime = now;
      
      time += 0.01 * controls.simulationSpeed;

      cameraController.update();

      windSystem.baseSpeed = 0.03 * controls.windSpeed;
      windSystem.update(deltaTime);

      cloudSystem.humidity = 50 + Math.sin(time * 0.1) * 30;
      cloudSystem.temperature = 20 + Math.sin(time * 0.05) * 10;
      cloudSystem.evaporationRate = controls.evaporationRate;

      cloudSystem.update(deltaTime, windSystem);
      
      const precipClouds = cloudSystem.getPrecipitatingClouds();
      precipSystem.update(precipClouds, windSystem, deltaTime);
      lightningSystem.update(precipClouds, deltaTime);

      cloudSystem.clouds.forEach((cloud, i) => {
        cloud.position.y = cloud.userData.targetHeight + 
          Math.sin(time * cloud.userData.floatSpeed + i) * 1.5;
        
        cloud.rotation.y += cloud.userData.rotationSpeed * controls.simulationSpeed;
        
        cloud.userData.structureElements.forEach(element => {
          element.material.uniforms.time.value = time;
          element.material.uniforms.sunPosition.value.copy(sunLight.position).normalize();
        });
      });

      const cloudTypes = {
        'Cumulus Humilis': 0,
        'Cumulus Mediocris': 0,
        'Cumulus Congestus': 0,
        'Cumulonimbus': 0,
        'Supercell': 0,
        'Stratocumulus': 0,
        'Nimbostratus': 0,
        'Altocumulus': 0,
        'Altostratus': 0,
        'Cirrus': 0,
        'Cirrocumulus': 0,
        'Cirrostratus': 0
      };
      
      cloudSystem.clouds.forEach(cloud => {
        const typeMap = {
          'cumulus_humilis': 'Cumulus Humilis',
          'cumulus_mediocris': 'Cumulus Mediocris',
          'cumulus_congestus': 'Cumulus Congestus',
          'cumulonimbus': 'Cumulonimbus',
          'supercell': 'Supercell',
          'stratocumulus': 'Stratocumulus',
          'nimbostratus': 'Nimbostratus',
          'altocumulus': 'Altocumulus',
          'altostratus': 'Altostratus',
          'cirrus': 'Cirrus',
          'cirrocumulus': 'Cirrocumulus',
          'cirrostratus': 'Cirrostratus'
        };
        cloudTypes[typeMap[cloud.userData.type]]++;
      });
      
      setStats({
        cloudCount: cloudSystem.clouds.length,
        precipitation: precipClouds.length > 0 ? `Active (${precipClouds.length} clouds)` : 'None',
        temperature: cloudSystem.temperature.toFixed(1),
        humidity: controls.humidity.toFixed(1),
        windSpeed: (windSystem.getWindSpeed() * controls.windSpeed * 100).toFixed(1),
        cloudTypes
      });

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      containerRef.current?.removeChild(renderer.domElement);
      cloudSystem.clouds.forEach(cloud => {
        scene.remove(cloud);
        cloud.userData.structureElements.forEach(element => {
          element.geometry.dispose();
          element.material.dispose();
        });
      });
      precipSystem.cleanup();
      lightningSystem.cleanup();
      ground.geometry.dispose();
      ground.material.dispose();
      renderer.dispose();
    };
  }, [controls]);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', margin: 0, padding: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      
      {/* GUI Toggle Button */}
      <button
        onClick={() => setGuiVisible(!guiVisible)}
        style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 20px',
          background: 'rgba(0,0,0,0.6)',
          color: 'white',
          border: '2px solid rgba(255,255,255,0.3)',
          borderRadius: '8px',
          cursor: 'pointer',
          fontFamily: 'Arial, sans-serif',
          fontSize: '14px',
          fontWeight: 'bold',
          pointerEvents: 'auto',
          zIndex: 1000,
          transition: 'all 0.3s'
        }}
        onMouseEnter={(e) => e.target.style.background = 'rgba(0,0,0,0.8)'}
        onMouseLeave={(e) => e.target.style.background = 'rgba(0,0,0,0.6)'}
      >
        {guiVisible ? '🙈 Hide GUI' : '👁️ Show GUI'}
      </button>
      
      {guiVisible && (
        <>
          {/* Stats Panel */}
          <div style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            color: 'white',
            fontFamily: 'Arial, sans-serif',
            textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.4)',
            padding: '15px',
            borderRadius: '8px',
            maxWidth: '300px'
          }}>
            <h2 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>Weather Simulation</h2>
            <div style={{ fontSize: '13px', lineHeight: '1.8' }}>
              <div><strong>Total Clouds:</strong> {stats.cloudCount}</div>
              
              <div style={{ marginLeft: '10px', fontSize: '11px', opacity: 0.9, lineHeight: '1.4', marginTop: '5px' }}>
                {stats.cloudTypes['Cumulus Humilis'] > 0 && <div>Cu Humilis: {stats.cloudTypes['Cumulus Humilis']}</div>}
                {stats.cloudTypes['Cumulus Mediocris'] > 0 && <div>Cu Mediocris: {stats.cloudTypes['Cumulus Mediocris']}</div>}
                {stats.cloudTypes['Cumulus Congestus'] > 0 && <div>Cu Congestus: {stats.cloudTypes['Cumulus Congestus']}</div>}
                {stats.cloudTypes['Cumulonimbus'] > 0 && <div>Cumulonimbus: {stats.cloudTypes['Cumulonimbus']}</div>}
                {stats.cloudTypes['Supercell'] > 0 && <div>⚠️ Supercell: {stats.cloudTypes['Supercell']}</div>}
                {stats.cloudTypes['Stratocumulus'] > 0 && <div>Stratocumulus: {stats.cloudTypes['Stratocumulus']}</div>}
                {stats.cloudTypes['Nimbostratus'] > 0 && <div>Nimbostratus: {stats.cloudTypes['Nimbostratus']}</div>}
                {stats.cloudTypes['Altocumulus'] > 0 && <div>Altocumulus: {stats.cloudTypes['Altocumulus']}</div>}
                {stats.cloudTypes['Altostratus'] > 0 && <div>Altostratus: {stats.cloudTypes['Altostratus']}</div>}
                {stats.cloudTypes['Cirrus'] > 0 && <div>Cirrus: {stats.cloudTypes['Cirrus']}</div>}
                {stats.cloudTypes['Cirrocumulus'] > 0 && <div>Cirrocumulus: {stats.cloudTypes['Cirrocumulus']}</div>}
                {stats.cloudTypes['Cirrostratus'] > 0 && <div>Cirrostratus: {stats.cloudTypes['Cirrostratus']}</div>}
              </div>
              
              <div style={{ marginTop: '8px' }}><strong>Precipitation:</strong> {stats.precipitation}</div>
              <div><strong>Wind Speed:</strong> {stats.windSpeed} km/h</div>
              <div><strong>Temperature:</strong> {stats.temperature}°C</div>
              <div><strong>Humidity:</strong> {stats.humidity}%</div>
            </div>
          </div>

          {/* Controls Panel */}
          <div style={{
            position: 'absolute',
            bottom: '20px',
            left: '20px',
            color: 'white',
            fontFamily: 'Arial, sans-serif',
            background: 'rgba(0,0,0,0.4)',
            padding: '15px',
            borderRadius: '8px',
            pointerEvents: 'auto',
            minWidth: '280px'
          }}>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '16px' }}>Simulation Controls</h3>
            
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '5px' }}>
                Humidity: {controls.humidity.toFixed(0)}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={controls.humidity}
                onChange={(e) => setControls(prev => ({ ...prev, humidity: parseFloat(e.target.value) }))}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '3px' }}>
                Controls moisture and cloud formation
              </div>
            </div>
            
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '5px' }}>
                Formation Rate: {controls.evaporationRate.toFixed(2)}x
              </label>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.1"
                value={controls.evaporationRate}
                onChange={(e) => setControls(prev => ({ ...prev, evaporationRate: parseFloat(e.target.value) }))}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '3px' }}>
                Higher = more clouds form
              </div>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '5px' }}>
                Wind Speed: {controls.windSpeed.toFixed(2)}x
              </label>
              <input
                type="range"
                min="0"
                max="3"
                step="0.1"
                value={controls.windSpeed}
                onChange={(e) => setControls(prev => ({ ...prev, windSpeed: parseFloat(e.target.value) }))}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '5px' }}>
                Simulation Speed: {controls.simulationSpeed.toFixed(2)}x
              </label>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.1"
                value={controls.simulationSpeed}
                onChange={(e) => setControls(prev => ({ ...prev, simulationSpeed: parseFloat(e.target.value) }))}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {/* Camera Controls Info */}
          <div style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            color: 'white',
            fontFamily: 'Arial, sans-serif',
            textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.3)',
            padding: '12px',
            borderRadius: '8px',
            fontSize: '11px',
            maxWidth: '280px',
            lineHeight: '1.5'
          }}>
            <div style={{ marginBottom: '10px', fontWeight: 'bold', fontSize: '12px' }}>🎮 Controls (Surface View)</div>
            <div><strong>WASD / Arrows:</strong> Move around</div>
            <div><strong>Q / E:</strong> Crouch / Stand (0.5-5m)</div>
            <div><strong>Mouse Drag:</strong> Look around</div>
            <div><strong>Mobile:</strong> Left=Move, Right=Look</div>
            
            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.3)', fontWeight: 'bold', fontSize: '12px' }}>
              ☁️ Cloud Types
            </div>
            <div style={{ marginTop: '6px' }}>
              <div><strong>Low Clouds:</strong></div>
              <div style={{ marginLeft: '8px', opacity: 0.9 }}>
                Cumulus Humilis • Mediocris<br/>
                Cumulus Congestus 🌧️<br/>
                Cumulonimbus ⚡<br/>
                Supercell ⚠️🌪️⚡<br/>
                Stratocumulus • Nimbostratus 🌧️
              </div>
              
              <div style={{ marginTop: '6px' }}><strong>Mid Clouds:</strong></div>
              <div style={{ marginLeft: '8px', opacity: 0.9 }}>
                Altocumulus • Altostratus 🌧️
              </div>
              
              <div style={{ marginTop: '6px' }}><strong>High Clouds:</strong></div>
              <div style={{ marginLeft: '8px', opacity: 0.9 }}>
                Cirrus • Cirrocumulus • Cirrostratus
              </div>
            </div>
            
            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.3)', fontWeight: 'bold', fontSize: '12px' }}>
              🌧️ Rain Effects
            </div>
            <div style={{ marginTop: '6px', opacity: 0.9 }}>
              • Realistic rain streaks<br/>
              • Dynamic splash particles<br/>
              • Mist from heavy impacts<br/>
              • Wind-affected trajectories
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default VolumetricClouds;