// A local component. Note: nothing imports it anywhere — the plugin should
// auto-import it wherever `<HelloWorld />` appears.
export default function HelloWorld({ name }: { name: string }) {
  return <h1>Hello, {name}! 👋</h1>;
}
