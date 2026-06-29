// A local component. Nothing imports it anywhere — the plugin auto-imports it
// wherever `<HelloWorld />` appears.
export default function HelloWorld({ name }) {
  return <h1>Hello, {name}! 👋</h1>;
}
