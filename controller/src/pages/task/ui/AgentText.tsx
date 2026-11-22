// biome-ignore-all lint/suspicious/noArrayIndexKey: blocks and pieces are re-parsed from the text on every render and have no ids; text only grows at the end, so position is identity
import { Linking, ScrollView, View } from "react-native";
import { parseMarkdown, type Inline } from "../../../shared/lib";
import { Inset, space, Text } from "../../../shared/ui";

function Pieces({ inline }: { inline: Inline[] }) {
  return inline.map((piece, i) => {
    if (piece.code) {
      return (
        <Text key={i} variant="subheadline" code style={{ padding: 0 }}>
          {piece.text}
        </Text>
      );
    }
    if (piece.link) {
      const url = piece.link;
      return (
        <Text key={i} role="link" tone="link" style={{ textDecorationLine: "underline" }} onPress={() => Linking.openURL(url)}>
          {piece.text}
        </Text>
      );
    }
    return piece.bold ? (
      <Text key={i} strong>
        {piece.text}
      </Text>
    ) : (
      piece.text
    );
  });
}

// controller-prototype's AgentText: the Markdown an Agent writes.
export function AgentText({ text }: { text: string }) {
  return (
    <View style={{ gap: space.sm }}>
      {parseMarkdown(text).map((block, i) => {
        switch (block.kind) {
          case "code":
            return (
              <Inset key={i}>
                <ScrollView horizontal>
                  <Text variant="footnote" mono selectable>
                    {block.text}
                  </Text>
                </ScrollView>
              </Inset>
            );
          case "heading":
            return (
              <Text key={i} variant="headline" selectable>
                <Pieces inline={block.inline} />
              </Text>
            );
          case "item":
            return (
              <View key={i} style={{ flexDirection: "row", gap: space.sm, paddingLeft: space.xs }}>
                <Text tone="secondary">{block.marker}</Text>
                <Text variant="prose" selectable style={{ flex: 1 }}>
                  <Pieces inline={block.inline} />
                </Text>
              </View>
            );
          case "paragraph":
            return (
              <Text key={i} variant="prose" selectable>
                <Pieces inline={block.inline} />
              </Text>
            );
          case "quote":
            // No divider lines in this app: a quiet fill and a step in from the margin mark it.
            return (
              <Inset key={i}>
                <Text selectable tone="secondary">
                  <Pieces inline={block.inline} />
                </Text>
              </Inset>
            );
          case "table":
            return (
              <View key={i} style={{ gap: space.xs }}>
                <View style={{ flexDirection: "row", gap: space.md }}>
                  {block.header.map((cell, c) => (
                    <Text key={c} variant="footnote" strong style={{ flex: 1 }}>
                      <Pieces inline={cell} />
                    </Text>
                  ))}
                </View>
                {block.rows.map((row, r) => (
                  <View key={r} style={{ flexDirection: "row", gap: space.md }}>
                    {row.map((cell, c) => (
                      <Text key={c} variant="footnote" tone="secondary" selectable style={{ flex: 1 }}>
                        <Pieces inline={cell} />
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            );
        }
        return null;
      })}
    </View>
  );
}
