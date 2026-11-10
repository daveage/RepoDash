/** electron-vite copies a `?asset` import into the build and resolves it to the file's path at runtime. */
declare module '*?asset' {
  const path: string
  export default path
}
