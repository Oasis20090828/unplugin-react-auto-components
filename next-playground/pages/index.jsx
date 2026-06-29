// `App` is used WITHOUT an import — the plugin injects it. App in turn uses
// <HelloWorld/> (local) and antd components, all auto-imported too.
export default function Home() {
  return <App />;
}
