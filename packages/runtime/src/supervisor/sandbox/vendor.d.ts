// A file Bun puts in the compiled binary (`with { type: "file" }`): the import is its path.
declare module "*/apply-seccomp" {
  const path: string;
  export default path;
}
