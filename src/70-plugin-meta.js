export default {
  id: "mermaid-flow",
  name: "Mermaid Flow",
  defaultEnabled: true,
  register(ctx) {
    storage = ctx.storage;

    const open = () => host.navigate("/mermaid-flow");

    ctx.registerMany([
      {
        id: "status",
        area: STATUSBAR_AREAS.right,
        order: 130,
        render: () => jsx(FlowStatusItem, {}),
      },
      {
        id: "page",
        area: ROUTES_AREA,
        data: { path: "/mermaid-flow" },
        render: () => jsx(FlowPage, {}),
      },
      {
        id: "nav",
        area: SIDEBAR_NAV_AREA,
        data: {
          path: "/mermaid-flow",
          label: "Mermaid Flow",
          codicon: "type-hierarchy-sub",
        },
      },
      {
        id: "open",
        area: PALETTE_AREA,
        data: {
          id: "mermaid-flow.open",
          action: "mermaid-flow.open",
          label: "Open Mermaid Flow",
          keywords: ["mermaid", "diagram", "flow", "docs"],
          run: open,
        },
      },
      {
        id: "open-key",
        area: KEYBINDS_AREA,
        data: {
          id: "mermaid-flow.open",
          label: "Open Mermaid Flow",
          category: "Mermaid Flow",
          defaults: ["mod+shift+m"],
          run: open,
        },
      },
    ]);
  },
};
