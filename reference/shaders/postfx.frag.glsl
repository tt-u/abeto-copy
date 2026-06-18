precision ${e.mediumPrecision} float;
precision ${e.mediumPrecision} sampler2D;
uniform sampler2D uTexture;
uniform float value;
varying highp vec2 vUv;
void main () {
    gl_FragColor.rgb = value * texture2D(uTexture, vUv).rgb;
    gl_FragColor.a = 1.0;
}
