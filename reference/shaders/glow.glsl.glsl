#define outPos pc_fragColor
uniform sampler2D tTexture1;
uniform mat4 uProjMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uModelMatrix;
uniform vec3 uMousePos;
uniform int uSnap;
uniform Global{
    vec2 resolution;
    float time;
    float dtRatio;
};

void main() {
    ivec2 uv = ivec2(gl_FragCoord.xy);
    vec3 pos = texelFetch(tTexture1, uv, 0).xyz;
    if (uv.x == 0) {
        pos = uMousePos;
    }
    else {
        vec3 nextPos = texelFetch(tTexture1, uv - ivec2(1, 0), 0).xyz;
        pos = mix(pos, nextPos, clamp(dtRatio, 0.0, 1.0));
        if (uSnap == 1) pos = uMousePos;
    }
    outPos = vec4(pos, 1.0);
}
