const TWO_PI: f32 = 6.28318548;
const PI: f32 = 3.14159274;
const INV_TWO_PI: f32 = 0.159154937; // 1 / (2π)
const INV_255: f32 = 0.0039215689;

struct LoadingCB {
  mat_world_view_proj: mat4x4f,       // c0..c3
  theta_scales: vec4f,                // c4  — sector angle / span
  other_scales: vec4f,                // c5  — radius / height scales
  vertex_timescale: vec4f,            // c6  — .z = smoothedFrac, .w = elapsed
  pass_modes: vec4f,                  // c7  — .x outline|guide, .y ambient, .zw = 1/extent
  slice_times: array<vec4f, 65>,      // c8..c72 — build stamps per tent sample
  egg_scales: vec4f,                  // c73 — easter-egg UV scale/bias
  pixel_timescale: vec4f,             // c74 — same as vertex timescale for PS
  pixel_inverse_volume: vec4f,        // c75 — 1/volume dims; .w = light intensity
  pixel_volume: vec4f,                // c76 — volume dims (64, 32, 4, …)
  composite_control: vec4f,           // c77 — HSV / overlay fade
  line_constants: array<vec4f, 8>,    // c78..c85 — outline start/end radii
}

@group(0) @binding(0) var<uniform> cb: LoadingCB;

@group(0) @binding(1)  var cell_sampler: texture_2d<f32>;
@group(0) @binding(2)  var mask_sampler: texture_2d<f32>;
@group(0) @binding(3)  var egg_sampler: texture_2d<f32>;
@group(0) @binding(4)  var volume_sampler: texture_3d<f32>;
@group(0) @binding(5)  var particle_sampler: texture_2d<f32>;
@group(0) @binding(6)  var source_sampler: texture_2d<f32>;

@group(0) @binding(7)  var samp_cell: sampler;
@group(0) @binding(8)  var samp_mask: sampler;
@group(0) @binding(9)  var samp_egg: sampler;
@group(0) @binding(10) var samp_volume: sampler;
@group(0) @binding(11) var samp_particle: sampler;
@group(0) @binding(12) var samp_source: sampler;

// -----------------------------------------------------------------------------
// Vertex I/O
// -----------------------------------------------------------------------------

struct VsIn {
  @location(0) attr0: vec4f, // xyz = lattice / position; .w = volume seed (points)
  @location(1) attr1: vec4f, // stage-specific (normal, line id, jitter, …)
  @builtin(vertex_index) vid: u32,
}

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) t0: vec4f,
  @location(1) t1: vec4f,
  @location(2) t2: vec4f,
  @location(3) t3: vec4f,
}

fn empty_vs_out() -> VsOut {
  var o: VsOut;
  o.pos = vec4f(0.0);
  o.t0 = vec4f(0.0);
  o.t1 = vec4f(0.0);
  o.t2 = vec4f(0.0);
  o.t3 = vec4f(0.0);
  return o;
}

fn gray4(g: f32) -> vec4f {
  return vec4f(g, g, g, g);
}

fn gray4_opaque(g: f32) -> vec4f {
  return vec4f(g, g, g, 1.0);
}

// -----------------------------------------------------------------------------
// Shared math
// -----------------------------------------------------------------------------

fn mul_row_major(v: vec4f, m: mat4x4f) -> vec4f {
  return v.x * m[0] + v.y * m[1] + v.z * m[2] + v.w * m[3];
}

fn wrap_angle(theta: f32) -> f32 {
  var n = theta * INV_TWO_PI + 0.5;
  n = n - floor(n);
  return n * TWO_PI - PI;
}

// Xbox vs_egg / vs_points:
//   r = (sin*r, cos*r, height), then dp4 cN.zxyw → (cos*r, height, sin*r).
fn ring_polar(u: f32, v: f32, w: f32, theta: vec4f, other: vec4f) -> vec3f {
  let angle = wrap_angle((u * 0.015625) * theta.y + theta.x);
  let height = (v * 0.03125) * other.z;
  let radius = (w * 0.25) * other.y + other.x;
  return vec3f(angle, height, radius);
}

fn ring_from_polar(angle: f32, height: f32, radius: f32) -> vec3f {
  let a = wrap_angle(angle);
  return vec3f(cos(a) * radius, height, sin(a) * radius);
}

fn ring_position(u: f32, v: f32, w: f32, theta: vec4f, other: vec4f) -> vec3f {
  let polar = ring_polar(u, v, w, theta, other);
  return ring_from_polar(polar.x, polar.y, polar.z);
}

fn is_finite_f32(x: f32) -> bool {
  // Exponent all-ones ⇒ Inf/NaN.
  return (bitcast<u32>(x) & 0x7f800000u) != 0x7f800000u;
}

// Expand a POINTLIST centre into a screen-space quad (vid % 6).
fn point_quad_corner(vid: u32) -> vec2f {
  let corner_id = vid % 6u;
  if (corner_id == 0u) { return vec2f(-1.0, -1.0); }
  if (corner_id == 1u) { return vec2f( 1.0, -1.0); }
  if (corner_id == 2u) { return vec2f(-1.0,  1.0); }
  if (corner_id == 3u) { return vec2f(-1.0,  1.0); }
  if (corner_id == 4u) { return vec2f( 1.0, -1.0); }
  return vec2f(1.0, 1.0);
}

// -----------------------------------------------------------------------------
// Texture helpers (Xbox POINT / BORDER semantics)
// -----------------------------------------------------------------------------

fn sample_r8_point_border(
  tex: texture_2d<f32>,
  samp: sampler,
  uv: vec2f,
) -> f32 {
  // Xbox POINT+BORDER (82201B68 mode 3): outside [0,1] including uv==1.0 → 0.
  // Egg mesh edges sit at v=32 / w=4 → UV 1.0; sampling the last texel there
  // leaves a noisy ghost rim on the outer ring.
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x >= 1.0 || uv.y >= 1.0) {
    return 0.0;
  }
  return textureSampleLevel(tex, samp, uv, 0.0).r;
}

fn sample_volume_point_wrap(uvw: vec3f) -> f32 {
  // Xbox volume tf0: POINT + WRAP, continuous UV (same as Ares Sample).
  return textureSampleLevel(volume_sampler, samp_volume, uvw, 0.0).r;
}

fn sample_mask_point_border(uv: vec2f) -> f32 {
  return sample_r8_point_border(mask_sampler, samp_mask, uv);
}

// Clamp-to-edge would sample the glyph edge and zero the ring via (1 - egg).
fn sample_egg_point_border(uv: vec2f) -> f32 {
  return sample_r8_point_border(egg_sampler, samp_egg, uv);
}

// Xbox vs_composite2 / ps_egg cell UV from volume fraction + face normal.
fn xbox_cell_uv(frac0: vec3f, n: vec3f) -> vec2f {
  let an = abs(n);
  return vec2f(
    frac0.y * an.x + frac0.x * an.y + an.z * frac0.x,
    frac0.z * (an.x + an.y) + an.z * frac0.y,
  );
}

// Age envelope → (lo, hi, rim) for ps_egg face lighting.
fn xbox_egg_age_lo_hi_rim(age: f32) -> vec3f {
  let early = select(0.0, 1.0, age <= 0.25);
  let late = select(0.0, 1.0, age >= 1.0);
  let mid = (1.0 - early) * (1.0 - late);

  let early_lo = age * 0.8 + 0.05;
  let early_hi = age * 40.0 - 10.0;
  let mid_lo = (age - 0.25) * (-0.26666668) + 0.25;
  let mid_hi = (age - 0.25) * 0.66666669;
  let late_half = min((age - 1.0) * 0.5, 1.0);
  let late_lo = late_half * (-0.03) + 0.05;
  let late_hi = late_half * 0.5 + 0.5;

  let lo = early * early_lo + mid * mid_lo + late * late_lo;
  let hi = early * early_hi + mid * mid_hi + late * late_hi;
  let rim = early * (age * 4.0) + (1.0 - early);
  return vec3f(lo, hi, rim);
}

fn linear_to_srgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(lo, hi, c > vec3f(0.0031308));
}

// =============================================================================
// Vertex shaders
// =============================================================================

@vertex
fn vs_egg(v: VsIn) -> VsOut {
  // t0 = volume UVW
  // t1 = face normal (attr1)
  // t2 = (a6, a7, sector progress, 0)
  // t3 = egg atlas UV
  var o: VsOut;
  let u = v.attr0.x;
  let v_coord = v.attr0.y;
  let w = v.attr0.z;

  let world = ring_position(u, v_coord, w, cb.theta_scales, cb.other_scales);
  o.pos = mul_row_major(vec4f(world, 1.0), cb.mat_world_view_proj);

  let egg_v = v_coord * 0.05 - 0.1875;
  let sector_u = u * 0.015625;
  o.t0 = vec4f(sector_u, v_coord * 0.03125, w * 0.25, 1.0);
  o.t1 = v.attr1;
  o.t2 = vec4f(
    v.attr0.w,
    v.attr1.w,
    sector_u * cb.theta_scales.w + cb.theta_scales.z,
    0.0,
  );
  o.t3 = vec4f(sector_u * cb.egg_scales.y + cb.egg_scales.x, 1.0 - egg_v, 0.0, 0.0);
  return o;
}

@vertex
fn vs_lines(v: VsIn) -> VsOut {
  // pass_modes.x > 0.5 → outline (!b4): polar ring + radius-off in t0.x
  // pass_modes.x < 0.5 → guides (b4): spherical patch
  var o: VsOut;
  let u = v.attr0.x;
  let v_coord = v.attr0.y;
  let w = v.attr0.z;
  let line_id = v.attr1.x;
  var world: vec3f;

  if (cb.pass_modes.x > 0.5) {
    let idx = clamp(i32(line_id), 0, 7);
    let t = clamp(u * 0.015625, 0.0, 1.0);
    world = ring_position(u, v_coord, w, cb.theta_scales, cb.other_scales);
    let radius_off = mix(cb.line_constants[idx].x, cb.line_constants[idx].y, t);
    o.t0 = vec4f(radius_off, 0.0, 0.0, 1.0);
  } else {
    let a = wrap_angle((u * 0.004032258) * cb.theta_scales.w + cb.theta_scales.z);
    let b = wrap_angle((w * 0.16666667) * cb.theta_scales.y + cb.theta_scales.x);
    let radial = cb.other_scales.x * cos(a);
    world = vec3f(cos(b) * radial, sin(a) * cb.other_scales.y, sin(b) * radial);
    o.t0 = vec4f(u * cb.other_scales.z * 0.00390625, 0.0, 0.0, 1.0);
  }

  o.pos = mul_row_major(vec4f(world, 1.0), cb.mat_world_view_proj);
  o.t1 = vec4f(0.0);
  o.t2 = vec4f(0.0);
  o.t3 = vec4f(0.0);
  return o;
}

@vertex
fn vs_points(v: VsIn) -> VsOut {
  // t0 = (sprite UV, intensity, 1)
  var o: VsOut;
  let u = v.attr0.x;
  let v_coord = v.attr0.y;
  let w = v.attr0.z;
  let vol = v.attr0.w * INV_255; // Xbox UBYTE4 / 255

  var polar = ring_polar(u + 0.5, v_coord + 0.5, w + 0.5, cb.theta_scales, cb.other_scales);
  var angle = polar.x;
  var height = polar.y;
  var radius = polar.z;

  let ambient = cb.pass_modes.y;
  var pts_base = 4.0;
  var intensity = 0.002;

  if (ambient > 0.5) {
    // Ambient sparkle: jitter from attr1, fixed intensity.
    angle += v.attr1.x;
    radius += v.attr1.y;
    height += v.attr1.z;
    pts_base = abs(v.attr1.x) * 50.0 + 4.0;
    intensity = 0.002;
  } else {
    // Build particles: fly in before stamp+2, then settle.
    var idx = i32(trunc(u));
    idx = clamp(idx, 0, 64);

    let time = cb.vertex_timescale.w;
    let birth = cb.slice_times[idx].x + v.attr1.w + 2.0;
    let inbound = clamp((birth - time) * 0.33333334, 0.0, 1.0);
    let alive = select(0.0, 1.0, time >= birth);

    let inbound_lin = inbound * (1.0 - alive);
    let inbound_pow4 = inbound_lin * inbound_lin * inbound_lin * inbound_lin;
    let inbound_pow3 = inbound_lin * inbound_lin * inbound_lin;

    angle += inbound_pow4 * v.attr1.x;
    radius += inbound_lin * v.attr1.y;
    height += inbound_pow3 * v.attr1.z;
    pts_base = 4.0;

    let age_term = 0.04 - 0.04 * clamp((time - birth) * 0.5, 0.0, 1.0);
    let in_term = 0.04 - 0.035 * sqrt(inbound);
    intensity = vol * select(in_term, age_term, alive > 0.5);
  }

  let world = ring_from_polar(angle, height, radius);
  var clip = mul_row_major(vec4f(world, 1.0), cb.mat_world_view_proj);

  if (clip.w <= 0.0 || clip.z <= 0.0) {
    return empty_vs_out();
  }

  // Xbox oPts = pts_base / clip.z; intensity /= max(0.25*z, 0.25).
  // oPts is framebuffer pixels; pass_modes.zw = 1/width, 1/height.
  let corner = point_quad_corner(v.vid);
  let o_pts = clamp(pts_base / clip.z, 1.0, 64.0);
  intensity = intensity / max(0.25 * clip.z, 0.25);
  let inv_extent = cb.pass_modes.zw;
  clip = vec4f(clip.xy + corner * (o_pts * inv_extent) * clip.w, clip.z, clip.w);

  o.pos = clip;
  o.t0 = vec4f(corner * 0.5 + 0.5, intensity, 1.0);
  o.t1 = vec4f(0.0);
  o.t2 = vec4f(0.0);
  o.t3 = vec4f(0.0);
  return o;
}

@vertex
fn vs_screen(v: VsIn) -> VsOut {
  var o: VsOut;
  o.pos = vec4f(v.attr0.xy, 0.0, 1.0);
  o.t0 = vec4f(v.attr1.xy, 0.0, 1.0);
  o.t1 = vec4f(0.0);
  o.t2 = vec4f(0.0);
  o.t3 = vec4f(0.0);
  return o;
}

// =============================================================================
// Pixel shaders
// =============================================================================

@fragment
fn ps_egg(i: VsOut) -> @location(0) vec4f {
  let uvw0 = i.t0.xyz;
  let normal = i.t1.xyz;
  let weight0 = i.t2.x; // a6
  let weight1 = i.t2.y; // a7
  let progress = i.t2.z;
  let egg_uv = i.t3.xy;

  let uvw1 = uvw0 - normal * cb.pixel_inverse_volume.xyz;

  let egg = sample_egg_point_border(egg_uv);
  let vol0 = sample_volume_point_wrap(uvw0);
  let vol1 = sample_volume_point_wrap(uvw1);
  let frac0 = fract(uvw0 * cb.pixel_volume.xyz);

  let idx0 = clamp(i32(trunc(uvw0.x * 64.0)), 0, 64);
  let idx1 = clamp(i32(trunc(uvw1.x * 64.0)), 0, 64);

  let delay0 = vol0 + cb.slice_times[idx0].x + 2.0;
  let delay1 = vol1 + cb.slice_times[idx1].x + 2.0;
  let age0 = cb.pixel_timescale.w - delay0;
  let age1 = cb.pixel_timescale.w - delay1;

  let cell = textureSample(cell_sampler, samp_cell, xbox_cell_uv(frac0, normal)).r;
  let mask0 = sample_mask_point_border(uvw0.yz);
  let mask1 = sample_mask_point_border(uvw1.yz);
  let built0 = select(0.0, 1.0, cb.pixel_timescale.w >= delay0);
  let built1 = select(0.0, 1.0, cb.pixel_timescale.w >= delay1);

  let env0 = xbox_egg_age_lo_hi_rim(age0);
  let env1 = xbox_egg_age_lo_hi_rim(age1);
  let face0 = max(mix(env0.y, env0.z, cell), 0.0); // mix(hi, rim, cell)
  let face1 = max(mix(env1.y, env1.z, cell), 0.0);

  let lit = cb.pixel_inverse_volume.w;
  let sample0 = face0 * env0.x * (lit * mask0) * built0;
  let sample1 = face1 * env1.x * (lit * mask1) * built1;
  var gray = weight0 * sample0 + weight1 * sample1;
  gray *= progress * (1.0 - egg);
  return gray4(gray);
}

@fragment
fn ps_lines(i: VsOut) -> @location(0) vec4f {
  let fade = cb.pixel_inverse_volume.w;

  // Guides: flat intensity from t0.x
  if (cb.pass_modes.x < 0.5) {
    return gray4_opaque(i.t0.x * fade);
  }

  // Outlines: tip / mid / body pulse along remaining radius
  let remain = cb.pixel_timescale.z - i.t0.x;
  if (remain < 0.0) {
    return vec4f(0.0);
  }

  let body = select(0.0, 1.0, remain >= 0.01);
  let tip = select(0.0, 1.0, 0.001 >= remain);
  let mid = (1.0 - body) * (1.0 - tip);
  let pulse = min((remain - 0.01) * 2.0408163, 1.0);

  var gray = (pulse * -0.1 + 0.2) * body;
  gray += mid * ((remain - 0.001) * -22.222223 + 0.4);
  gray += (remain * 400.0) * tip;
  gray *= fade;
  return gray4_opaque(gray);
}

@fragment
fn ps_points(i: VsOut) -> @location(0) vec4f {
  let sprite = textureSample(particle_sampler, samp_particle, i.t0.xy).r;
  let gray = sprite * i.t0.z * 4.0 * cb.pixel_inverse_volume.w;
  return gray4(gray);
}

@fragment
fn ps_overlay(i: VsOut) -> @location(0) vec4f {
  let alpha = textureSample(source_sampler, samp_source, i.t0.xy).r;
  let rgb = alpha * cb.composite_control.xyz;
  return vec4f(rgb, 1.0);
}

@fragment
fn ps_composite(i: VsOut) -> @location(0) vec4f {
  let src = textureSample(source_sampler, samp_source, i.t0.xy);
  var rgb = xbox_ps_composite_colorize(src.r, cb.composite_control);
  rgb *= cb.composite_control.w;
  // WebGPU canvas is sRGB; encode so presentation matches D3D UNORM viewing.
  rgb = linear_to_srgb(rgb);
  return vec4f(rgb, 1.0);
}

// =============================================================================
// Xbox ps_composite colorize — faithful b132 register dance
// (carve-embedded constants c253 / c254 / c255). Do not “simplify”.
// =============================================================================

fn xbox_ps_composite_colorize(tex_r: f32, c11: vec4f) -> vec3f {
  let c253 = vec4f(-1.0, 0.0, 0.66666669, 0.5);
  let c254 = vec4f(6.0, 3.0, 0.33333334, -0.33333334);
  let c255 = vec4f(1.3333334, 1.0, 0.66666663, 2.0);

  var r0 = vec4f(0.0);
  var r1 = vec4f(0.0);
  var r2 = vec4f(0.0);
  var r3 = vec4f(0.0);
  var r4 = vec4f(0.0);
  var r5 = vec4f(0.0);
  var r6 = vec4f(0.0);

  // --- Hue offsets from composite_control.x ---------------------------------
  r0.y = c11.x + c254.z;
  r0.z = c11.x + c254.w;
  r1 = vec4f(c11.x + c255.x, c11.x + c255.y, c11.x + c255.z, r1.w);

  let log_r = select(-3.4e38, log2(abs(tex_r)), tex_r != 0.0);
  r1.w = select(c11.x, r1.y, (-c11.x > 0.0));
  {
    let old_r1 = r1;
    r1.x = select(r0.z, old_r1.z, (-r0.z > 0.0));
    r1.y = select(r0.y, old_r1.x, (-r0.y > 0.0));
  }

  r2.x = c11.y + c255.y;
  r0.x = c11.z * log_r;
  {
    let old_r1 = r1;
    r1.x = old_r1.y;
    r1.z = old_r1.x;
  }

  r0.x = exp2(r0.x);
  if (!is_finite_f32(r0.x)) {
    r0.x = 0.0;
  }

  // --- Value / saturation prep ----------------------------------------------
  r3.y = select(0.0, 1.0, c253.w >= r0.x);
  r0.y = c11.y + r0.x;
  r2.w = -r0.x * c11.y + r0.y;
  r0.y = r1.z + c253.x;
  r0.z = r1.w + c253.x;
  r0.w = r1.x + c253.x;
  r3.x = r0.x * r2.x;
  r2.x = select(0.0, 1.0, r1.z > c255.y);
  r2.y = select(0.0, 1.0, r1.w > c255.y);
  r2.z = select(0.0, 1.0, r1.x > c255.y);
  r1.x = select(r0.w, r1.y, r2.z == 0.0);
  r3.x = select(r2.w, r3.x, r3.y > 0.0);

  {
    let old_r0 = r0;
    r0.y = select(old_r0.z, r1.w, r2.y == 0.0);
    r0.z = select(old_r0.y, r1.z, r2.x == 0.0);
  }

  r1.y = r0.y;
  r1.w = r0.z;
  r1.z = r0.x * c255.w - r3.x;
  r0.w = -r1.z + r3.x;
  r5 = vec4f(r5.x, r5.y, r1.x + r1.x, r1.x + r1.x);
  r6.x = r0.w * r1.x;
  r4.y = r0.z + r0.z;

  r4.x = r0.z * c254.y;
  r4.z = r0.z * c254.x;
  r4.w = r0.y * c254.x;
  r6.y = c253.z - r1.w;
  r3.y = r1.x * c254.x;
  r3.z = r1.x * c254.y;
  r3.w = r1.y * c254.y;
  r6.z = c253.z - r1.y;
  r2 = vec4f(r0.w * r0.y, r0.w * r0.z, r2.z, r2.w);
  r6.w = c253.z - r1.x;

  {
    let old_r4 = r4;
    r4.x = select(0.0, 1.0, c255.w > old_r4.x);
    r4.y = select(0.0, 1.0, c255.y > old_r4.y);
    r4.z = select(0.0, 1.0, c255.y > old_r4.z);
    r4.w = select(0.0, 1.0, c255.y > old_r4.w);
  }

  r5.x = r3.z;
  {
    let old_r6 = r6;
    // r6.yzw = r0.w * old_r6.wzy
    r6.y = r0.w * old_r6.w;
    r6.z = r0.w * old_r6.z;
    r6.w = r0.w * old_r6.y;
  }
  r5.y = r3.w;
  r1.x = select(0.0, 1.0, c255.y > r3.y);
  r2.z = r6.z;

  r0.y = r6.x * c254.x + r1.z;
  r0.z = r6.y * c254.x + r1.z;
  {
    let old_r5 = r5;
    r5.x = select(0.0, 1.0, c255.w > old_r5.x);
    r5.y = select(0.0, 1.0, c255.y > old_r5.z);
    r5.z = select(0.0, 1.0, c255.w > old_r5.y);
    r5.w = select(0.0, 1.0, c255.y > old_r5.w);
  }
  r2.w = r6.w;
  r0.z = select(r0.z, r1.z, r5.x == 0.0);

  {
    let old_r2 = r2;
    // r2 = old_r2.ywxz * c254.xxxx + r1.zzzz
    r2 = vec4f(
      old_r2.y * c254.x + r1.z,
      old_r2.w * c254.x + r1.z,
      old_r2.x * c254.x + r1.z,
      old_r2.z * c254.x + r1.z,
    );
  }

  r0.w = select(r2.w, r1.z, r5.z == 0.0);
  {
    let old_r0 = r0;
    r0.z = select(r3.x, old_r0.z, r5.y == 0.0);
    r0.w = select(r3.x, old_r0.w, r5.w == 0.0);
  }

  r1.y = select(r0.y, r0.z, r1.x == 0.0);
  r1.x = r0.w;
  {
    let old_r1 = r1;
    r1.z = select(r2.z, old_r1.x, r4.w == 0.0);
    r1.w = select(r2.y, old_r1.z, r4.x == 0.0);
  }

  r0.y = select(r3.x, r1.w, r4.y == 0.0);
  r1.x = select(r2.x, r0.y, r4.z == 0.0);

  if (r0.x == 0.0) {
    return vec3f(0.0);
  }
  return r1.yzx;
}
