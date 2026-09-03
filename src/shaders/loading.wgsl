// Halo 3 loading-screen shaders — faithful HLSL→WGSL port of
// Ares rasterizer_loading_screen_shaders.inl (default_logs.xex VA 0x829485A0).
// CPU uploads the same row-major float[16] WVP as Ares. WGSL packs those
// floats as columns, so m[i] == row i of the HLSL row_major matrix.
// HLSL `mul(v, M)` is therefore v.x*m[0] + v.y*m[1] + v.z*m[2] + v.w*m[3],
// NOT `m * v`.

fn mul_row_maj(v: vec4f, m: mat4x4f) -> vec4f {
  return v.x * m[0] + v.y * m[1] + v.z * m[2] + v.w * m[3];
}

struct LoadingCB {
  // packoffset(c0) .. c3 — 64 bytes
  mat_world_view_proj: mat4x4f,
  // c4
  theta_scales: vec4f,
  // c5
  other_scales: vec4f,
  // c6
  vertex_timescale: vec4f,
  // c7
  pass_modes: vec4f,
  // c8 .. c72
  slice_times: array<vec4f, 65>,
  // c73
  egg_scales: vec4f,
  // c74
  pixel_timescale: vec4f,
  // c75
  pixel_inverse_volume: vec4f,
  // c76
  pixel_volume: vec4f,
  // c77
  composite_control: vec4f,
  // c78 .. c85 — total 86 float4 slots = 1376 bytes
  line_constants: array<vec4f, 8>,
}

@group(0) @binding(0) var<uniform> cb: LoadingCB;
@group(0) @binding(1) var cell_sampler: texture_2d<f32>;
@group(0) @binding(2) var mask_sampler: texture_2d<f32>;
@group(0) @binding(3) var egg_sampler: texture_2d<f32>;
@group(0) @binding(4) var volume_sampler: texture_3d<f32>;
@group(0) @binding(5) var particle_sampler: texture_2d<f32>;
@group(0) @binding(6) var source_sampler: texture_2d<f32>;
@group(0) @binding(7) var samp_cell: sampler;
@group(0) @binding(8) var samp_mask: sampler;
@group(0) @binding(9) var samp_egg: sampler;
@group(0) @binding(10) var samp_volume: sampler;
@group(0) @binding(11) var samp_particle: sampler;
@group(0) @binding(12) var samp_source: sampler;

struct VsIn {
  @location(0) attr0: vec4f,
  @location(1) attr1: vec4f,
  @builtin(vertex_index) vid: u32,
}

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) t0: vec4f,
  @location(1) t1: vec4f,
  @location(2) t2: vec4f,
  @location(3) t3: vec4f,
}

fn wrap_angle(theta: f32) -> f32 {
  var n = theta * 0.159154937 + 0.5;
  n = n - floor(n);
  return n * 6.28318548 - 3.14159274;
}

// Xbox vs_egg / vs_points: r=(sin*r, cos*r, height), dp4 cN.zxyw =>
// (cos*r, height, sin*r).
fn ring_polar(u: f32, v: f32, w: f32, theta: vec4f, other: vec4f) -> vec3f {
  let angle = wrap_angle((u * 0.015625) * theta.y + theta.x);
  let height = (v * 0.03125) * other.z;
  let radius = (w * 0.25) * other.y + other.x;
  return vec3f(angle, height, radius);
}

fn ring_from_polar(angle: f32, height: f32, radius: f32) -> vec3f {
  let a = wrap_angle(angle);
  let s = sin(a);
  let c = cos(a);
  return vec3f(c * radius, height, s * radius);
}

fn ring_position(u: f32, v: f32, w: f32, theta: vec4f, other: vec4f) -> vec3f {
  let polar = ring_polar(u, v, w, theta, other);
  return ring_from_polar(polar.x, polar.y, polar.z);
}

@vertex
fn vs_egg(v: VsIn) -> VsOut {
  var o: VsOut;
  let u = v.attr0.x;
  let vv = v.attr0.y;
  let w = v.attr0.z;
  let world = ring_position(u, vv, w, cb.theta_scales, cb.other_scales);
  o.pos = mul_row_maj(vec4f(world, 1.0), cb.mat_world_view_proj);
  let r0x = vv * 0.05 - 0.1875;
  let r0z = u * 0.015625;
  o.t0 = vec4f(r0z, vv * 0.03125, w * 0.25, 1.0);
  o.t1 = v.attr1;
  o.t2 = vec4f(v.attr0.w, v.attr1.w, r0z * cb.theta_scales.w + cb.theta_scales.z, 0.0);
  o.t3 = vec4f(r0z * cb.egg_scales.y + cb.egg_scales.x, 1.0 - r0x, 0.0, 0.0);
  return o;
}

@vertex
fn vs_lines(v: VsIn) -> VsOut {
  var o: VsOut;
  let u = v.attr0.x;
  let vv = v.attr0.y;
  let w = v.attr0.z;
  let line_id = v.attr1.x;
  var world: vec3f;
  if (cb.pass_modes.x > 0.5) {
    let idx = clamp(i32(line_id), 0, 7);
    let t = clamp(u * 0.015625, 0.0, 1.0);
    // Xbox vs_lines !b4: world is the same polar as vs_egg
    world = ring_position(u, vv, w, cb.theta_scales, cb.other_scales);
    let radius_off = mix(cb.line_constants[idx].x, cb.line_constants[idx].y, t);
    o.t0 = vec4f(radius_off, 0.0, 0.0, 1.0);
  } else {
    // Xbox vs_lines b4 (guides): spherical patch
    let a = wrap_angle((u * 0.004032258) * cb.theta_scales.w + cb.theta_scales.z);
    let b = wrap_angle((w * 0.16666667) * cb.theta_scales.y + cb.theta_scales.x);
    let sa = sin(a);
    let ca = cos(a);
    let sb = sin(b);
    let cb_ang = cos(b);
    let radial = cb.other_scales.x * ca;
    world = vec3f(cb_ang * radial, sa * cb.other_scales.y, sb * radial);
    o.t0 = vec4f(u * cb.other_scales.z * 0.00390625, 0.0, 0.0, 1.0);
  }
  o.pos = mul_row_maj(vec4f(world, 1.0), cb.mat_world_view_proj);
  o.t1 = vec4f(0.0);
  o.t2 = vec4f(0.0);
  o.t3 = vec4f(0.0);
  return o;
}

@vertex
fn vs_points(v: VsIn) -> VsOut {
  var o: VsOut;
  let u = v.attr0.x;
  let vv = v.attr0.y;
  let w = v.attr0.z;
  // Xbox UBYTE4 attr0.w / 255
  let vol = v.attr0.w * 0.0039215689;
  var polar = ring_polar(u + 0.5, vv + 0.5, w + 0.5, cb.theta_scales, cb.other_scales);
  var angle = polar.x;
  var height = polar.y;
  var radius = polar.z;

  let ambient = cb.pass_modes.y;
  var pts_base = 4.0;
  var intensity = 0.002;
  if (ambient > 0.5) {
    angle += v.attr1.x;
    radius += v.attr1.y;
    height += v.attr1.z;
    pts_base = abs(v.attr1.x) * 50.0 + 4.0;
    intensity = 0.002;
  } else {
    var idx = i32(trunc(u));
    if (idx < 0) {
      idx = 0;
    } else if (idx > 64) {
      idx = 64;
    }
    let time = cb.vertex_timescale.w;
    let birth = cb.slice_times[idx].x + v.attr1.w + 2.0;
    let inbound = clamp((birth - time) * 0.33333334, 0.0, 1.0);
    let alive = select(0.0, 1.0, time >= birth);
    let r3z = inbound * (1.0 - alive);
    var r3x = r3z * r3z;
    r3x = r3x * r3x;
    let r3y = r3z * r3z * r3z;
    angle += r3x * v.attr1.x;
    radius += r3z * v.attr1.y;
    height += r3y * v.attr1.z;
    pts_base = 4.0;
    let age_term = 0.04 - 0.04 * clamp((time - birth) * 0.5, 0.0, 1.0);
    let in_term = 0.04 - 0.035 * sqrt(inbound);
    intensity = vol * select(in_term, age_term, alive > 0.5);
  }

  let world = ring_from_polar(angle, height, radius);
  var clip = mul_row_maj(vec4f(world, 1.0), cb.mat_world_view_proj);

  let corner_id = v.vid % 6u;
  var corner: vec2f;
  if (corner_id == 0u) {
    corner = vec2f(-1.0, -1.0);
  } else if (corner_id == 1u) {
    corner = vec2f(1.0, -1.0);
  } else if (corner_id == 2u) {
    corner = vec2f(-1.0, 1.0);
  } else if (corner_id == 3u) {
    corner = vec2f(-1.0, 1.0);
  } else if (corner_id == 4u) {
    corner = vec2f(1.0, -1.0);
  } else {
    corner = vec2f(1.0, 1.0);
  }

  if (clip.w <= 0.0 || clip.z <= 0.0) {
    o.pos = vec4f(0.0);
    o.t0 = vec4f(0.0);
    o.t1 = vec4f(0.0);
    o.t2 = vec4f(0.0);
    o.t3 = vec4f(0.0);
    return o;
  }

  // Xbox oPts = r2.y / clip.z; o0 /= max(0.25*clip.z, 0.25). POINTLIST
  // expansion rebuilt with vid%6 quad. oPts is framebuffer pixels; pass_modes.zw
  // is 1/width, 1/height of the current RT (any resolution).
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

// Xbox vs_composite2 cell UV helper
fn xbox_cell_uv(frac0: vec3f, n: vec3f) -> vec2f {
  let an = abs(n);
  return vec2f(
    frac0.y * an.x + frac0.x * an.y + an.z * frac0.x,
    frac0.z * (an.x + an.y) + an.z * frac0.y
  );
}

fn sample_volume_point_wrap(uvw: vec3f) -> f32 {
  let dim = cb.pixel_volume.xyz;
  var lattice = floor(uvw * dim);
  lattice = lattice - dim * floor(lattice / dim);
  let uv = (lattice + vec3f(0.5)) * cb.pixel_inverse_volume.xyz;
  return textureSampleLevel(volume_sampler, samp_volume, uv, 0.0).r;
}

fn sample_mask_point_border(uv: vec2f) -> f32 {
  let dim = vec2f(32.0, 4.0);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    return 0.0;
  }
  let lattice = min(floor(uv * dim), dim - vec2f(1.0));
  return textureSampleLevel(mask_sampler, samp_mask, (lattice + vec2f(0.5)) / dim, 0.0).r;
}

// Xbox egg tf3: POINT + BORDER. Clamp-to-edge would sample the glyph edge
// and zero the ring via ps_egg's (1 - egg).
fn sample_egg_point_border(uv: vec2f) -> f32 {
  let dim = vec2f(138.0, 10.0);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    return 0.0;
  }
  let lattice = min(floor(uv * dim), dim - vec2f(1.0));
  return textureSampleLevel(egg_sampler, samp_egg, (lattice + vec2f(0.5)) / dim, 0.0).r;
}

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

fn is_finite_f32(x: f32) -> bool {
  // Exponent bits all-ones => Inf/NaN. Reject those; keep finite values only.
  return (bitcast<u32>(x) & 0x7f800000u) != 0x7f800000u;
}

@fragment
fn ps_egg(i: VsOut) -> @location(0) vec4f {
  let uvw0 = i.t0.xyz;
  let n = i.t1.xyz;
  let a6 = i.t2.x;
  let a7 = i.t2.y;
  let progress = i.t2.z;
  let egg_uv = i.t3.xy;

  let uvw1 = uvw0 - n * cb.pixel_inverse_volume.xyz;

  let egg = sample_egg_point_border(egg_uv);
  let vol1 = sample_volume_point_wrap(uvw1);
  let vol0 = sample_volume_point_wrap(uvw0);

  let frac0 = fract(uvw0 * cb.pixel_volume.xyz);

  let idx0 = clamp(i32(trunc(uvw0.x * 64.0)), 0, 64);
  let idx1 = clamp(i32(trunc(uvw1.x * 64.0)), 0, 64);

  let delay0 = vol0 + cb.slice_times[idx0].x + 2.0;
  let delay1 = vol1 + cb.slice_times[idx1].x + 2.0;
  let age0 = cb.pixel_timescale.w - delay0;
  let age1 = cb.pixel_timescale.w - delay1;

  let cell = textureSample(cell_sampler, samp_cell, xbox_cell_uv(frac0, n)).r;

  let mask0 = sample_mask_point_border(uvw0.yz);
  let mask1 = sample_mask_point_border(uvw1.yz);

  let built0 = select(0.0, 1.0, cb.pixel_timescale.w >= delay0);
  let built1 = select(0.0, 1.0, cb.pixel_timescale.w >= delay1);

  let age_lo_hi_rim0 = xbox_egg_age_lo_hi_rim(age0);
  let age_lo_hi_rim1 = xbox_egg_age_lo_hi_rim(age1);
  let lo0 = age_lo_hi_rim0.x;
  let hi0 = age_lo_hi_rim0.y;
  let rim0 = age_lo_hi_rim0.z;
  let lo1 = age_lo_hi_rim1.x;
  let hi1 = age_lo_hi_rim1.y;
  let rim1 = age_lo_hi_rim1.z;

  let face0 = max(mix(hi0, rim0, cell), 0.0);
  let face1 = max(mix(hi1, rim1, cell), 0.0);

  let lit = cb.pixel_inverse_volume.w;
  let s0 = face0 * lo0 * (lit * mask0) * built0;
  let s1 = face1 * lo1 * (lit * mask1) * built1;
  var gray = a6 * s0 + a7 * s1;

  gray *= progress * (1.0 - egg);
  return vec4f(gray, gray, gray, gray);
}

@fragment
fn ps_lines(i: VsOut) -> @location(0) vec4f {
  let fade = cb.pixel_inverse_volume.w;
  if (cb.pass_modes.x < 0.5) {
    let gray = i.t0.x * fade;
    return vec4f(gray, gray, gray, 1.0);
  }

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
  return vec4f(gray, gray, gray, 1.0);
}

@fragment
fn ps_points(i: VsOut) -> @location(0) vec4f {
  let sprite = textureSample(particle_sampler, samp_particle, i.t0.xy).r;
  let gray = sprite * i.t0.z * 4.0 * cb.pixel_inverse_volume.w;
  return vec4f(gray, gray, gray, gray);
}

// Xbox ps_composite b132 register dance (carve embedded c253/c254/c255).
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
      old_r2.z * c254.x + r1.z
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

fn linear_to_srgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(lo, hi, c > vec3f(0.0031308));
}

@fragment
fn ps_composite(i: VsOut) -> @location(0) vec4f {
  let src = textureSample(source_sampler, samp_source, i.t0.xy);
  var rgb = xbox_ps_composite_colorize(src.r, cb.composite_control);
  rgb *= cb.composite_control.w;
  // WebGPU canvas is composited as sRGB. Encode so presentation matches
  // D3D UNORM swap-chain viewing (raw linear on an sRGB surface looks washed).
  rgb = linear_to_srgb(rgb);
  return vec4f(rgb, 1.0);
}

@fragment
fn ps_overlay(i: VsOut) -> @location(0) vec4f {
  let a = textureSample(source_sampler, samp_source, i.t0.xy).r;
  let rgb = a * cb.composite_control.xyz;
  return vec4f(rgb, 1.0);
}
