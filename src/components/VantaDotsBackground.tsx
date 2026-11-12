import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface VantaDotsBackgroundProps {
  color?: string;
  palette?: string[];
  backgroundColor?: string;
  config?: {
    springSpeed: number;
    dotSize: number;
    splash: number;
  };
  power?: number;
}

function createCircleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.beginPath();
    context.arc(64, 64, 64, 0, Math.PI * 2);
    context.fillStyle = '#ffffff';
    context.fill();
  }
  return new THREE.CanvasTexture(canvas);
}

export function VantaDotsBackground({ color, palette, backgroundColor, config, power = 1 }: VantaDotsBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const configRef = useRef(config);
  const powerRef = useRef(power);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    powerRef.current = power;
  }, [power]);

  useEffect(() => {
    if (!containerRef.current) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    const scene = new THREE.Scene();
    const bgColor = new THREE.Color(backgroundColor || '#09090b');
    scene.background = bgColor;

    scene.fog = new THREE.Fog(bgColor, 500, 2000);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 5000);
    camera.position.set(0, 150, 400);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    while (containerRef.current.firstChild) {
      containerRef.current.removeChild(containerRef.current.firstChild);
    }
    containerRef.current.appendChild(renderer.domElement);

    const spacing = 50;
    const initialDotSizeVal = configRef.current?.dotSize ?? 4;
    const dotsColor = new THREE.Color(color || '#00ff00');

    const circleTexture = createCircleTexture();

    const hasMultiColor = !!(palette && palette.length > 1);
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.PointsMaterial({
      color: hasMultiColor ? 0xffffff : dotsColor,
      vertexColors: hasMultiColor,
      size: initialDotSizeVal,
      map: circleTexture,
      transparent: true,
      opacity: 0.8,
      alphaTest: 0.5,
    });

    const positions: number[] = [];
    const basePositions: number[] = [];
    const pointColors: number[] = [];
    const gridScale = 50;

    const activePalette = (palette && palette.length > 0) ? palette : [color || '#00ff00'];
    const parsedColors = activePalette.map(c => new THREE.Color(c));

    for (let i = -gridScale; i <= gridScale; i++) {
        for (let j = -gridScale; j <= gridScale; j++) {
            const x = i * spacing + spacing / 2;
            const y = (Math.random() * 10) - 150;
            const z = j * spacing + spacing / 2;

            positions.push(x, y, z);
            basePositions.push(x, y, z);

            const colorIndex = Math.abs(i + j) % parsedColors.length;
            const c = parsedColors[colorIndex];
            pointColors.push(c.r, c.g, c.b);
        }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (hasMultiColor) {
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(pointColors, 3));
    }
    const dots = new THREE.Points(geometry, material);
    scene.add(dots);

    const splashes: { x: number, z: number, time: number, maxRadius: number }[] = [];

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let currentMouseX = 0;
    let currentMouseY = 0;

    const handleResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    };

    const handleMouseMove = (event: MouseEvent) => {
        currentMouseX = (event.clientX / window.innerWidth) * 2 - 1;
        currentMouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    };

    const handleClick = (event: MouseEvent) => {
        if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, label, [role="button"], [role="switch"]')) {
            return;
        }

        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 140);
        const target = new THREE.Vector3();
        const intersectPoint = raycaster.ray.intersectPlane(plane, target);

        const currentConfig = configRef.current;
        const splashVal = currentConfig?.splash ?? 50;
        const splashMultiplier = Math.max(0.1, splashVal / 50);

        if (intersectPoint) {
            splashes.push({ x: target.x, z: target.z, time: 0, maxRadius: 400 * splashMultiplier });
        }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('click', handleClick);

    let frameId: number;
    let time = 0;

    let scrollZ = 0;

    const animate = () => {
        const currentConfig = configRef.current;
        const springSpeed = currentConfig?.springSpeed ?? 50;
        const dotSizeVal = currentConfig?.dotSize ?? 4;
        const splashVal = currentConfig?.splash ?? 50;

        material.size = dotSizeVal;

        const speedMultiplier = Math.max(0.1, springSpeed / 50);
        const energyWaveSpeed = powerRef.current;
        const splashMultiplier = Math.max(0.1, splashVal / 50);

        const baseScrollSpeed = 0.3;
        const speed = baseScrollSpeed * speedMultiplier;

        time += 0.015 * energyWaveSpeed;
        scrollZ += speed;

        const posAttr = geometry.attributes.position;
        const positionsArr = posAttr.array as Float32Array;

        const targetCamX = currentMouseX * 100;
        const targetCamY = 150 + (-currentMouseY * 50);

        camera.position.x += (targetCamX - camera.position.x) * 0.05;
        camera.position.y += (targetCamY - camera.position.y) * 0.05;
        camera.lookAt(camera.position.x * 0.5, 0, camera.position.z - 800);

        for (let i = splashes.length - 1; i >= 0; i--) {
            splashes[i].time += 0.04 * Math.max(0.5, speedMultiplier);

            if (splashes[i].time > Math.PI) {
                splashes.splice(i, 1);
            }
        }

        const numPoints = positionsArr.length / 3;
        for (let i = 0; i < numPoints; i++) {
            const idx = i * 3;

            const bx = basePositions[idx];
            const by = basePositions[idx + 1];
            let bz = basePositions[idx + 2];

            bz += scrollZ;

            const thresholdZ = camera.position.z + 100;
            while (bz > thresholdZ) {
                bz -= (gridScale * 2 * spacing);
                basePositions[idx+2] -= (gridScale * 2 * spacing);
            }

            let targetY = by + Math.sin(bz * 0.015 + bx * 0.01 + time) * 20 * energyWaveSpeed;

            for (const splash of splashes) {
                const dx = bx - splash.x;
                const dz = bz - splash.z;
                const dist = Math.sqrt(dx*dx + dz*dz);

                const waveRadius = splash.time * (250 * splashMultiplier);

                const distFromWave = dist - waveRadius;
                const splashWidth = 100 * splashMultiplier;
                const splashHeight = 90 * splashMultiplier;

                if (Math.abs(distFromWave) < splashWidth * 3 && dist < splash.maxRadius) {
                    const x = (distFromWave / splashWidth) * 2;

                    const wave = (1 - x * x) * Math.exp(-0.5 * x * x);

                    const fade = Math.max(0, 1 - (splash.time / Math.PI));

                    targetY += wave * splashHeight * fade;
                }
            }

            positionsArr[idx] = bx;
            positionsArr[idx + 1] = targetY;
            positionsArr[idx + 2] = bz;
        }

        posAttr.needsUpdate = true;
        renderer.render(scene, camera);
        frameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('click', handleClick);
        cancelAnimationFrame(frameId);

        geometry.dispose();
        material.dispose();
        renderer.dispose();

        if (containerRef.current && containerRef.current.firstChild) {
            containerRef.current.removeChild(containerRef.current.firstChild);
        }
    };
  }, [color, backgroundColor]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: -1,
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
