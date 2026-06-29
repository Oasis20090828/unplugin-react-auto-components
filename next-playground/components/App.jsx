// ⚠️ Look ma, no imports!
//   - <HelloWorld /> is a LOCAL component (auto-imported via AST scan)
//   - <ExtraHelloWorld /> is a SECOND local component also named HelloWorld
//     (in components/extra) — auto-namespaced by its dir so both still import
//   - <AntSpace>, <AntButton>, <AntTag> come from antd (AntdResolver, "Ant" prefix)
//   - <UiButton>, <UiCard> come from shadcn/ui (ShadcnResolver, "Ui" prefix)
//   Two resolvers + local discovery (with a name collision), side by side, zero imports.
export default function App() {
  return (
    <AntApp>
      <AntSpace orientation="vertical" size="large" style={{ padding: 24 }}>
        <HelloWorld name="unplugin-react-auto-components" />
        <ExtraHelloWorld />

        {/* antd */}
        <AntSpace>
          <AntButton type="primary">Primary</AntButton>
          <AntButton danger>Danger</AntButton>
          <AntTag color="blue">auto-imported</AntTag>
        </AntSpace>

        {/* shadcn/ui — Tailwind-styled, Ui-prefixed */}
        <UiCard className="p-4">
          <p className="mb-3 text-sm text-muted-foreground">
            shadcn/ui auto-imported via <code>&lt;UiButton/&gt;</code> /{" "}
            <code>&lt;UiCard/&gt;</code>
          </p>
          <div className="flex gap-2">
            <UiButton>Default</UiButton>
            <UiButton variant="outline">Outline</UiButton>
            <UiButton variant="destructive">Destructive</UiButton>
          </div>
        </UiCard>
      </AntSpace>
    </AntApp>
  );
}
