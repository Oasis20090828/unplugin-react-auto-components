// Same export name `HelloWorld` as components/Hello.jsx — a real name collision.
// The plugin keeps the lowest-path one (components/Hello) as the bare
// <HelloWorld/> and namespaces THIS one by its parent dir → <ExtraHelloWorld/>.
// Both stay auto-importable; the dts is deterministic (no dev rewrite loop).
export default function HelloWorld() {
  return (
    <p style={{ color: "#16a34a", margin: 0 }}>
      👋 a second <code>HelloWorld</code> (from components/extra) — auto-imported
      as <code>&lt;ExtraHelloWorld/&gt;</code>
    </p>
  );
}
