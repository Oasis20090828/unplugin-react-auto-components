// ⚠️ Look ma, no imports!
//   - <HelloWorld /> is a LOCAL component (auto-imported via AST scan)
//   - <Space>, <Button>, <Tag> come from Antd (auto-imported via AntdResolver)
//   - The <Space> with multiple children compiles to jsxs(...) in prod —
//     exercises the jsxs path.
export default function App() {
  return (
    <AntApp>
      <AntSpace size="large" style={{ padding: 24 }}>
        <HelloWorld name="unplugin-react-auto-components" />
        <AntSpace>
          <AntButton type="primary">Primary</AntButton>
          <AntButton danger>Danger</AntButton>
          <AntTag color="blue">auto-imported</AntTag>
        </AntSpace>
      </AntSpace>
    </AntApp>
  );
}
