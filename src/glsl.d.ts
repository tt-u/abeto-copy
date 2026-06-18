// Shader imports (handled by vite-plugin-glsl) resolve to their source string.
declare module "*.glsl" {
  const source: string;
  export default source;
}
declare module "*.vert" {
  const source: string;
  export default source;
}
declare module "*.frag" {
  const source: string;
  export default source;
}
