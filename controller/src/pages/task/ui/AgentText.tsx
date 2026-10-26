import { Linking, ScrollView, View } from "react-native";
import { parseMarkdown, type Inline } from "../../../shared/lib";
import { radius, space, Text, useColors } from "../../../shared/ui";

function Pieces({ inline }: { inline: Inline[] }) {
  const colors = useColors();
  return inline.map((piece, i) => {
    if (piece.code) {
      return (
        <Text key={i} variant="subheadline" mono style={{ backgroundColor: colors.fill }}>
          {piece.text}
        </Text>
      );
    }
    if (piece.link) {
      const url = piece.link;
      return (
        <Text key={i} role="link" style={{ color: colors.blue }} onPress={() => Linking.openURL(url)}>
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

export function AgentText({ text }: { text: string }) {
  const colors = useColors();
  return (
    <View style={{ gap: space.sm }}>
      {parseMarkdown(text).map((block, i) => {
        switch (block.kind) {
          case "code":
            return (
              <ScrollView
                key={i}
                horizontal
                style={{ borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.fill }}
                contentContainerStyle={{ padding: space.md }}
              >
                <Text variant="footnote" mono selectable>
                  {block.text}
                </Text>
              </ScrollView>
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
                <Text selectable style={{ flex: 1 }}>
                  <Pieces inline={block.inline} />
                </Text>
              </View>
            );
          case "paragraph":
            return (
              <Text key={i} selectable>
                <Pieces inline={block.inline} />
              </Text>
            );
        }
      })}
    </View>
  );
}
