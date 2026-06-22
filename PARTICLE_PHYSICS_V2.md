# Hero particle physics v2 - flow-field / wake (matches the reference video)

## What the video actually shows (studied frame-by-frame)
I extracted the hero segment of the reference clip at 5-8 fps and zoomed into the brain while
it reacts. The motion is **not** a radial "push bubble." Frame-by-frame you can see:

- Particles **peel off the brain surface** near the disturbance and **gain velocity**.
- They **stream away in curved filament trails** (comet/smoke-like wisps), not straight out.
- The streaks **follow the direction the disturbance travels** (a *wake*), with a **swirl/curl**.
- After the disturbance passes, particles **slowly flow back and re-coalesce** into the brain.

That means each particle needs **velocity + inertia + damping** and a **slow spring back to
home**, plus a cursor force built from three parts: a small **radial lift**, a **tangential
swirl**, and a **drag/wake** along the cursor's travel direction.

## Why v1 looked wrong
v1 set particle positions directly each frame:
```js
if(d2<R2){ const f=fall*fall*push; X+=dx*inv*f; ... }
```
No velocity => no inertia => no trails, no swirl, no wake, and an instant (rubber-band) snap
back. It reads as a stiff bubble, which is the "wrong physics" you noticed.

---

## The fix (drop-in)

### 1) Pointer tracking (unchanged from v1 - keep this)
In the custom-cursor block:
```js
const pointer={x:0,y:0,has:false};   // normalized device coords (-1..1)
let pEnergy=0, pLastX=0, pLastY=0;    // rises with cursor speed, decays when still
addEventListener('mousemove',e=>{
  tx=e.clientX; ty=e.clientY;
  pointer.x=(e.clientX/innerWidth)*2-1;
  pointer.y=-(e.clientY/innerHeight)*2+1;
  const dx=e.clientX-pLastX, dy=e.clientY-pLastY; pLastX=e.clientX; pLastY=e.clientY;
  if(pointer.has) pEnergy=Math.min(1, pEnergy + Math.sqrt(dx*dx+dy*dy)*0.012);
  pointer.has=true;
});
addEventListener('mouseout',()=>{ pEnergy=0; });
```

### 2) Replace the morph/animation block with the velocity-based version
Replace from the `lerp` helper down to `geo.attributes.position.needsUpdate=true;`
(leave the colour block, camera, `renderer.render`, `requestAnimationFrame(frame)` as-is):

```js
// morph helper: pick targets across 3 stages
function lerp(a,b,t){return a+(b-a)*t;}

// ---- cursor -> particle interaction helpers ----
const _ray=new THREE.Raycaster();
const _ndc=new THREE.Vector2();
const _plane=new THREE.Plane(new THREE.Vector3(0,0,1),0); // intersect the z=0 plane
const _hit=new THREE.Vector3();
const _localCur=new THREE.Vector3();
let rotX=0, rotY=0;            // smoothed parallax tilt toward the cursor

// per-particle velocity -> inertia, trailing filaments, re-coalescing (flow-field physics)
const vel=new Float32Array(N*3);
let pcx=0, pcy=0, pcz=0, havePrev=false;        // previous cursor position (local space)
const SPRING=0.05, DAMP=0.87, R=4.8, R2=R*R;    // slow spring => particles trail then reform

let pr=0;
function frame(t){
  pr+=(scrollP-pr)*.06;
  const s=pr; // stage: 0->0.5 = A->B, 0.5->1 = B->C
  pEnergy*=0.93;

  // whole-cloud parallax tilt following the cursor
  const tgtRotY=pointer.x*0.6, tgtRotX=-pointer.y*0.4;
  rotY+=(tgtRotY-rotY)*0.05; rotX+=(tgtRotX-rotX)*0.05;
  points.rotation.y=t*0.00006 + pr*1.2 + rotY;
  points.rotation.x=Math.sin(t*0.0002)*0.1 + rotX;

  // cursor in local space + its per-frame velocity (this velocity is what creates the wake/streaks)
  points.updateMatrixWorld();
  _ndc.set(pointer.x, pointer.y);
  _ray.setFromCamera(_ndc, camera);
  let curActive=false, cvx=0, cvy=0, cvz=0, lcx=0, lcy=0, lcz=0;
  if(pointer.has && _ray.ray.intersectPlane(_plane,_hit)){
    _localCur.copy(_hit); points.worldToLocal(_localCur);
    lcx=_localCur.x; lcy=_localCur.y; lcz=_localCur.z; curActive=true;
    if(havePrev){ cvx=lcx-pcx; cvy=lcy-pcy; cvz=lcz-pcz; }
    pcx=lcx; pcy=lcy; pcz=lcz; havePrev=true;
  } else { havePrev=false; }
  // clamp cursor velocity so fast jumps don't explode the field
  cvx=Math.max(-0.6,Math.min(0.6,cvx)); cvy=Math.max(-0.6,Math.min(0.6,cvy)); cvz=Math.max(-0.6,Math.min(0.6,cvz));

  const wob=t*0.0006;
  for(let i=0;i<N;i++){
    // moving "home" = morph target + gentle living wobble
    let hx,hy,hz;
    if(s<0.5){const k=s/0.5;hx=lerp(A[i*3],B[i*3],k);hy=lerp(A[i*3+1],B[i*3+1],k);hz=lerp(A[i*3+2],B[i*3+2],k);}
    else{const k=(s-0.5)/0.5;hx=lerp(B[i*3],C[i*3],k);hy=lerp(B[i*3+1],C[i*3+1],k);hz=lerp(B[i*3+2],C[i*3+2],k);}
    hx+=Math.sin(wob+i)*0.05; hy+=Math.cos((wob+i)*1.1)*0.05;

    let px=pos[i*3], py=pos[i*3+1], pz=pos[i*3+2];
    let vx=vel[i*3], vy=vel[i*3+1], vz=vel[i*3+2];

    // 1) spring back toward home (slow -> particles trail, then re-coalesce into the brain)
    vx+=(hx-px)*SPRING; vy+=(hy-py)*SPRING; vz+=(hz-pz)*SPRING;

    // 2) cursor disturbance = radial lift + tangential swirl + drag/wake along cursor travel
    if(curActive){
      const dx=px-lcx, dy=py-lcy, dz=pz-lcz, d2=dx*dx+dy*dy+dz*dz;
      if(d2<R2){
        const dist=Math.sqrt(d2)+1e-4, w=1-dist/R, inv=1/dist, en=0.4+pEnergy;
        const fr=w*0.10*en;                                  // lift off the surface
        vx+=dx*inv*fr; vy+=dy*inv*fr; vz+=dz*inv*fr;
        const tl=Math.sqrt(dz*dz+dx*dx)+1e-4, ft=w*0.18*en;  // swirl  t=(-dz,0,dx)
        vx+=(-dz/tl)*ft; vz+=(dx/tl)*ft;
        const fd=w*1.0;                                      // wake: carried along cursor motion
        vx+=cvx*fd; vy+=cvy*fd; vz+=cvz*fd;
      }
    }

    // 3) damping + integrate
    vx*=DAMP; vy*=DAMP; vz*=DAMP;
    px+=vx; py+=vy; pz+=vz;
    vel[i*3]=vx; vel[i*3+1]=vy; vel[i*3+2]=vz;
    pos[i*3]=px; pos[i*3+1]=py; pos[i*3+2]=pz;
  }
  geo.attributes.position.needsUpdate=true;
```

---

## Tuning the feel
| Constant | Effect |
|---|---|
| `SPRING` (0.05) | how fast particles return home. Lower = longer trails / slower reform; higher = snappier. |
| `DAMP` (0.87) | velocity damping. Higher (0.92) = floatier, longer wisps; lower (0.80) = tighter, calmer. |
| `R` (4.8) | radius of the disturbance the cursor affects. |
| `fr` coeff (0.10) | radial lift - how much particles pop off the surface. |
| `ft` coeff (0.18) | swirl strength - the curl in the trails. Raise for more vortex. |
| `fd` (1.0) | wake strength - how strongly particles are dragged along the cursor's travel (the streaks). |
| `en = 0.4 + pEnergy` | `0.4` is the resting influence; `pEnergy` adds punch when the cursor moves fast. |
| `clamp(...,0.6)` | max wake impulse per frame - raise for wilder fast-swipes, lower for stability. |

Tips:
- Want longer comet trails like the video? Lower `SPRING` to ~0.035 and raise `DAMP` to ~0.9.
- Want a stronger vortex? Raise `ft` to ~0.28.
- Want the brain to barely move until you swipe? Lower the resting `0.4` to ~0.15.

---

## React / TanStack Start note
All of this lives in the client-only `useEffect`. Declare `vel`, `pcx/pcy/pcz`, `havePrev`,
`pointer`, `pEnergy`, `rotX/rotY`, and the `_ray/_ndc/_plane/_hit/_localCur` helpers inside the
effect. In the cleanup return: `cancelAnimationFrame(...)`, remove the `mousemove`/`mouseout`/
`resize` listeners, and dispose `renderer`, `geo`, and `mat` so route changes don't leak WebGL.

## Honest caveat
There's no browser in my build sandbox, so I verified this **structurally** (JS parses, logic is
sound) and tuned the constants from the video frames - not from a live render. If trails feel too
long/short or the swirl too strong, nudge `SPRING`, `DAMP`, `ft`, and `fd` per the table above.
