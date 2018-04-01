/*
 * CDDL HEADER START
 *
 * This file and its contents are supplied under the terms of the
 * Common Development and Distribution License ("CDDL"), version 1.0.
 * You may only use this file in accordance with the terms of version
 * 1.0 of the CDDL.
 *
 * A full copy of the text of the CDDL should have accompanied this
 * source.  A copy of the CDDL is also available via the Internet at
 * http://www.illumos.org/license/CDDL.
 *
 * CDDL HEADER END
 */
/*
 * Copyright 2018 Saso Kiselkov. All rights reserved.
 */

#version 120
#extension GL_EXT_gpu_shader4: require

/*
 * N.B. all temps are in Kelvin!
 */

uniform	sampler2D	src;
uniform	sampler2D	depth;
uniform float		rand_seed;
uniform float		le_temp;
uniform float		cabin_temp;
uniform float		wind_fact;
uniform float		d_t;
uniform float		inertia_in;
uniform vec4		heat_zones[4];
uniform float		heat_tgt_temps[4];
uniform float		precip_intens;

uniform vec2		hot_air_src[2];
uniform float		hot_air_radius[2];
uniform float		hot_air_temp[2];


/*
 * Gold Noise ©2017-2018 dcerisano@standard3d.com 
 *  - based on the Golden Ratio, PI and Square Root of Two
 *  - fastest noise generator function
 *  - works with all chipsets (including low precision)
 */
precision lowp float;

const float PHI = 1.61803398874989484820459 * 00000.1;	/* Golden Ratio */
const float PI  = 3.14159265358979323846264 * 00000.1;	/* PI */
const float SQ2 = 1.41421356237309504880169 * 10000.0;	/* Square Root of Two */
const float max_depth = 3.0;
const float rand_temp_scale = 5.0;
const float temp_scale_fact = 400.0;
const vec2 null_vec2 = vec2(-1000000.0);

float
gold_noise(vec2 coordinate, float seed)
{
	return (fract(sin(dot(coordinate * (seed + PHI), vec2(PHI, PI))) *
	    SQ2));
}

float
filter_in(float old_val, float new_val, float rate)
{
	float delta = new_val - old_val;
	float abs_delta = abs(delta);
	float inc_val = (delta * d_t) / rate;
	return (old_val + clamp(inc_val, -abs_delta, abs_delta));
}

void
main()
{
	vec2 my_size = textureSize2D(src, 0);
	float glass_temp = texture2D(src, gl_FragCoord.xy / my_size).r *
	    temp_scale_fact;
	float depth = texture2D(depth, gl_FragCoord.xy /
	    textureSize2D(depth, 0)).r;
	float rand_temp = 4 * (gold_noise(gl_FragCoord.xy, rand_seed) - 0.5);
	float inertia = inertia_in * (1 + depth);

	/* Protect from runaway values */
	if (glass_temp < 200 || glass_temp > temp_scale_fact)
		glass_temp = le_temp;

	glass_temp = filter_in(glass_temp, le_temp,
	    mix(inertia, inertia / 10, min(wind_fact + precip_intens, 1)));
	glass_temp = filter_in(glass_temp, cabin_temp, inertia * 2.5);

	/*
	 * Hot air blowing on the windshield?
	 */
	for (int i = 0; i < 2; i++) {
		float hot_air_dist;
		float radius;

		if (hot_air_radius[i] <= 0)
			continue;

		hot_air_dist = length(gl_FragCoord.xy -
		    hot_air_src[i] * my_size);
		radius = hot_air_radius[i] * my_size.x;
		glass_temp = filter_in(glass_temp, hot_air_temp[i],
		    inertia + max(2 * inertia * (hot_air_dist / radius), 1));
	}

	glass_temp = filter_in(glass_temp, glass_temp + rand_temp, 0.5);

	for (int i = 0; i < 4; i++) {
		float left, right, bottom, top, inertia_out = 100000;

		if (heat_zones[i].z == 0 || heat_zones[i].w == 0 ||
		    heat_tgt_temps[i] == 0)
			continue;

		left = heat_zones[i].x * my_size.x;
		right = heat_zones[i].y * my_size.x;
		bottom = heat_zones[i].z * my_size.y;
		top = heat_zones[i].w * my_size.y;

		if (left <= gl_FragCoord.x && right >= gl_FragCoord.x &&
		    bottom <= gl_FragCoord.y && top >= gl_FragCoord.y) {
			inertia_out = inertia;
		} else if (gl_FragCoord.x < left &&
		    gl_FragCoord.y >= bottom && gl_FragCoord.y <= top) {
			inertia_out = max(inertia * left - gl_FragCoord.x,
			    inertia);
		} else if (gl_FragCoord.x > right &&
		    gl_FragCoord.y >= bottom && gl_FragCoord.y <= top) {
			inertia_out = max(inertia * gl_FragCoord.x - right,
			    inertia);
		}

		glass_temp = filter_in(glass_temp, heat_tgt_temps[i],
		    inertia_out);
	}

	gl_FragColor = vec4(glass_temp / temp_scale_fact, 0, 0, 1.0);
}