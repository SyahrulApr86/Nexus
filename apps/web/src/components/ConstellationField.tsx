import { useEffect, useRef } from "react";
import * as THREE from "three";

const NODE_COUNT = 120;
const LINK_DISTANCE = 1.15;

function readToken(name: string, fallback: string): THREE.Color {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return new THREE.Color(raw || fallback);
}

/**
 * Ambient WebGL backdrop for the landing hero: drifting points that link up
 * when they come close, the same "notes find each other" idea the product is
 * about. Purely decorative — hidden from assistive tech, never interactive,
 * and skipped entirely under prefers-reduced-motion or without WebGL.
 */
export function ConstellationField() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return; // no WebGL — the gradient blobs behind this still carry the hero
    }

    const width = host.clientWidth;
    const height = host.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    camera.position.z = 6;

    const accent = readToken("--t-accent", "#0b5cd6");
    const mist = readToken("--t-mist", "#b1bbcd");

    // Points
    const positions = new Float32Array(NODE_COUNT * 3);
    const velocities = new Float32Array(NODE_COUNT * 3);
    for (let i = 0; i < NODE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 7;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 3;
      velocities[i * 3] = (Math.random() - 0.5) * 0.0016;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.0016;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.0008;
    }
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    const points = new THREE.Points(
      pointGeometry,
      new THREE.PointsMaterial({
        color: accent,
        size: 0.055,
        transparent: true,
        opacity: 0.75,
        sizeAttenuation: true,
      }),
    );
    scene.add(points);

    // Links — rebuilt each frame from whichever points are near each other
    const maxSegments = NODE_COUNT * 6;
    const linkPositions = new Float32Array(maxSegments * 6);
    const linkGeometry = new THREE.BufferGeometry();
    linkGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(linkPositions, 3),
    );
    const lines = new THREE.LineSegments(
      linkGeometry,
      new THREE.LineBasicMaterial({
        color: mist,
        transparent: true,
        opacity: 0.35,
      }),
    );
    scene.add(lines);

    let pointerX = 0;
    let pointerY = 0;
    const onPointerMove = (e: PointerEvent) => {
      pointerX = (e.clientX / window.innerWidth - 0.5) * 0.6;
      pointerY = (e.clientY / window.innerHeight - 0.5) * 0.4;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    let frame = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      frame = requestAnimationFrame(tick);

      const pos = pointGeometry.attributes.position!.array as Float32Array;
      for (let i = 0; i < NODE_COUNT; i++) {
        for (let axis = 0; axis < 3; axis++) {
          const idx = i * 3 + axis;
          pos[idx]! += velocities[idx]!;
          const bound = axis === 0 ? 6 : axis === 1 ? 3.5 : 1.5;
          if (pos[idx]! > bound || pos[idx]! < -bound) velocities[idx]! *= -1;
        }
      }
      pointGeometry.attributes.position!.needsUpdate = true;

      let segment = 0;
      for (let i = 0; i < NODE_COUNT && segment < maxSegments; i++) {
        for (let j = i + 1; j < NODE_COUNT && segment < maxSegments; j++) {
          const dx = pos[i * 3]! - pos[j * 3]!;
          const dy = pos[i * 3 + 1]! - pos[j * 3 + 1]!;
          const dz = pos[i * 3 + 2]! - pos[j * 3 + 2]!;
          if (dx * dx + dy * dy + dz * dz < LINK_DISTANCE * LINK_DISTANCE) {
            const o = segment * 6;
            linkPositions[o] = pos[i * 3]!;
            linkPositions[o + 1] = pos[i * 3 + 1]!;
            linkPositions[o + 2] = pos[i * 3 + 2]!;
            linkPositions[o + 3] = pos[j * 3]!;
            linkPositions[o + 4] = pos[j * 3 + 1]!;
            linkPositions[o + 5] = pos[j * 3 + 2]!;
            segment++;
          }
        }
      }
      linkGeometry.setDrawRange(0, segment * 2);
      linkGeometry.attributes.position!.needsUpdate = true;

      // Gentle parallax toward the pointer
      camera.position.x += (pointerX - camera.position.x) * 0.03;
      camera.position.y += (-pointerY - camera.position.y) * 0.03;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    };
    tick();

    const onResize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // Pause when the tab is hidden so the page costs nothing in the background
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(frame);
      } else if (!running) {
        running = true;
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      pointGeometry.dispose();
      linkGeometry.dispose();
      (points.material as THREE.Material).dispose();
      (lines.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 opacity-60"
      style={{
        // Keep the field at the edges: nothing drifts behind the headline.
        maskImage:
          "radial-gradient(ellipse 62% 58% at 50% 42%, transparent 40%, black 78%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 62% 58% at 50% 42%, transparent 40%, black 78%)",
      }}
    />
  );
}
