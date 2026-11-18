import { Vector2, Vector4 } from './vendor/three.module.js';

// A rough dark floor, sampled from the actual planar reflection camera.
// Fresnel, contact distance and progressive blur replace the old photo duplicates.
export function floorShader(count) {
  return {
    name: 'PhotographicFloor',
    uniforms: {
      color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
      uTexel: { value: new Vector2(1 / 1024, 1 / 768) },
      uContacts: { value: Array.from({ length: count }, () => new Vector4(0, 0, 0, 0)) },
    },
    vertexShader: `
      uniform mat4 textureMatrix;
      varying vec4 vReflection;
      varying vec3 vWorld;
      void main() {
        vReflection = textureMatrix * vec4(position, 1.0);
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform vec2 uTexel;
      uniform vec4 uContacts[${count}];
      varying vec4 vReflection;
      varying vec3 vWorld;
      void main() {
        vec2 uv = vReflection.xy / vReflection.w;
        float contactDistance = 100.0;
        for (int i = 0; i < ${count}; i++) {
          vec4 panel = uContacts[i];
          if (panel.w > 0.02) {
            float side = max(0.0, abs(vWorld.x - panel.x) - panel.z);
            float distance = length(vec2(side, vWorld.z - panel.y));
            contactDistance = min(contactDistance, distance);
          }
        }
        // Sharp at the frame's foot, progressively softer across polished stone.
        float spread = 0.65 + 5.0 * smoothstep(0.0, 5.0, contactDistance);
        vec2 r = uTexel * spread;
        vec3 reflection = texture2D(tDiffuse, uv).rgb * 0.20;
        reflection += texture2D(tDiffuse, uv + vec2(r.x, 0.0)).rgb * 0.12;
        reflection += texture2D(tDiffuse, uv - vec2(r.x, 0.0)).rgb * 0.12;
        reflection += texture2D(tDiffuse, uv + vec2(0.0, r.y)).rgb * 0.12;
        reflection += texture2D(tDiffuse, uv - vec2(0.0, r.y)).rgb * 0.12;
        reflection += texture2D(tDiffuse, uv + r * 0.707).rgb * 0.08;
        reflection += texture2D(tDiffuse, uv - r * 0.707).rgb * 0.08;
        reflection += texture2D(tDiffuse, uv + vec2(r.x, -r.y) * 0.707).rgb * 0.08;
        reflection += texture2D(tDiffuse, uv + vec2(-r.x, r.y) * 0.707).rgb * 0.08;
        vec3 viewDirection = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - abs(viewDirection.y), 5.0);
        float reflectance = mix(0.18, 0.40, fresnel);
        float fade = exp(-contactDistance * 0.34);
        // Avoid bright texture clamping at the outside of the reflection buffer.
        float edge = smoothstep(0.0, 0.018, uv.x) * smoothstep(0.0, 0.018, 1.0 - uv.x);
        edge *= smoothstep(0.0, 0.018, uv.y) * smoothstep(0.0, 0.018, 1.0 - uv.y);
        float stone = 0.0015;
        gl_FragColor = vec4(vec3(stone) + reflection * reflectance * fade * edge, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  };
}
