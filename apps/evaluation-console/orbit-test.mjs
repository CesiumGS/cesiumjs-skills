// Proves an "orbit around the framed subject" capture keeps the object centered,
// vs the current cardinal in-place rotation. Loads a real eval.html, settles,
// then captures the settled view + 4 orbit shots.
import { chromium } from "playwright";

// arg2 is a repo-relative path; served over http so tiles + depth-pick work like the runner.
const relPath = process.argv[2];
const outPrefix = process.argv[3] || "/tmp/qa/orbit";
const settleMs = Number(process.argv[4] || 5000);
const base = process.env.ORBIT_BASE || "http://localhost:8950/";

// The orbit logic that will become the pipeline fix. Captured the framed subject
// ONCE from the settled view, then lookAt-orbits around it at constant range/pitch.
const ORBIT_FN = `
// Find the bounding sphere of the SUBJECT the scene added (models, tilesets,
// primitive collections, entities) — NOT the globe — so we orbit the object.
function subjectSphere() {
  const C = Cesium;
  const spheres = [];
  try {
    const prims = viewer.scene.primitives;
    for (let i = 0; i < prims.length; i++) {
      const p = prims.get(i);
      try {
        // Models expose boundingSphere; 3D tilesets expose .boundingSphere; ground
        // primitives expose it after ready. Skip anything globe-sized.
        const bs = p && p.boundingSphere;
        if (bs && C.defined(bs.center) && isFinite(bs.radius) && bs.radius > 0 && bs.radius < 2.0e6) {
          spheres.push(bs);
        }
      } catch (e) {}
    }
  } catch (e) {}
  // Entities of ANY geometry type (polygons, polylines, rectangles, points,
  // billboards, model-entities) via the display's own bounding-sphere computation.
  try {
    const dsd = viewer.dataSourceDisplay;
    const scratch = new C.BoundingSphere();
    const now = viewer.clock ? viewer.clock.currentTime : undefined;
    for (const e of viewer.entities.values) {
      let got = false;
      try {
        const state = dsd.getBoundingSphere(e, false, scratch);
        if (state === C.BoundingSphereState.DONE && isFinite(scratch.radius) && scratch.radius >= 0) {
          spheres.push(C.BoundingSphere.clone(scratch));
          got = true;
        }
      } catch (e2) {}
      if (!got) {
        try {
          const pos = e.position && e.position.getValue(now);
          if (C.defined(pos)) spheres.push(new C.BoundingSphere(pos, 10));
        } catch (e3) {}
      }
    }
  } catch (e) {}
  if (!spheres.length) return undefined;
  return spheres.length === 1 ? spheres[0] : C.BoundingSphere.fromBoundingSpheres(spheres);
}

function orbitView(headingDegrees, index, pitchDegrees) {
  const C = Cesium;
  if (typeof viewer === 'undefined' || !viewer || !viewer.scene) return 'no-viewer';
  const scene = viewer.scene, camera = scene.camera;
  if (index === 0 || !window.__ORBIT__) {
    const bs = subjectSphere();
    if (bs) {
      // Range gives comfortable headroom so the whole subject reads from each side.
      const range = Math.max(bs.radius * 3.2, bs.radius + 60);
      window.__ORBIT__ = { mode: 'sphere', c: [bs.center.x, bs.center.y, bs.center.z], radius: bs.radius, range };
    } else {
      // No discrete subject (e.g. a whole-globe / imagery scene): orbit the point
      // the settled camera is looking at, preserving its distance.
      const px = new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
      let target;
      try { target = scene.pickPosition(px); } catch (e) {}
      if (!C.defined(target) || isNaN(target.x)) { try { target = camera.pickEllipsoid(px, scene.globe.ellipsoid); } catch (e) {} }
      if (!C.defined(target)) target = C.Cartesian3.add(camera.positionWC, C.Cartesian3.multiplyByScalar(camera.directionWC, 1500, new C.Cartesian3()), new C.Cartesian3());
      window.__ORBIT__ = { mode: 'look', c: [target.x, target.y, target.z], range: Math.max(50, C.Cartesian3.distance(camera.positionWC, target)) };
    }
  }
  const o = window.__ORBIT__;
  const center = new C.Cartesian3(o.c[0], o.c[1], o.c[2]);
  const pitch = C.Math.toRadians(pitchDegrees == null ? -30 : pitchDegrees);
  const hpr = new C.HeadingPitchRange(C.Math.toRadians(headingDegrees), pitch, o.range);
  if (o.mode === 'sphere') {
    camera.viewBoundingSphere(new C.BoundingSphere(center, o.radius), hpr);
  } else {
    camera.lookAt(center, hpr);
  }
  camera.lookAtTransform(C.Matrix4.IDENTITY); // release the temporary frame
  return o.mode;
}
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(base + relPath, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(settleMs);
await page.addScriptTag({ content: ORBIT_FN });

await page.screenshot({ path: `${outPrefix}-settled.png` });
const headings = [0, 90, 180, 270];
let how = "";
for (let i = 0; i < headings.length; i++) {
  how = await page.evaluate(([h, idx]) => orbitView(h, idx), [headings[i], i]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outPrefix}-${i}.png` });
}
console.log("subject located via:", how, "| pageerrors:", errs.length);
await browser.close();
