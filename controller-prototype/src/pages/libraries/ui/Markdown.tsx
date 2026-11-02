import { View } from "react-native";
import { pageName, wikiLinks, type Library } from "../../../entities/library";
import { space, Text } from "../../../shared/ui";

// A page as the Agent wrote it: [[links]] jump to the page they name; a link to a page that
// does not exist stays plain and says so.
// ponytail: headings, list items and links only; the real page is full Markdown in Obsidian.
export function Markdown({ library, content, onOpen }: { library: Library; content: string; onOpen: (path: string) => void }) {
  const exists = (name: string) => library.pages.some((page) => pageName(page.path) === name);
  return (
    <View style={{ gap: space.xs }}>
      {content.split("\n").map((line, index) => {
        const heading = /^#+\s+(.*)/.exec(line);
        if (!line.trim()) return <View key={index} style={{ height: space.xs }} />;
        return (
          <Text key={index} variant={heading ? "headline" : "subheadline"}>
            {(heading ? heading[1] : line).split(/(\[\[[^\]]+\]\])/).map((part, i) => {
              const name = wikiLinks(part)[0];
              if (!name) return part;
              if (!exists(name)) return <Text key={i} variant="subheadline" tone="secondary">{`${name} (ยังไม่มีหน้า)`}</Text>;
              return (
                <Text key={i} variant="subheadline" role="link" strong style={{ textDecorationLine: "underline" }} onPress={() => onOpen(`${name}.md`)}>
                  {name}
                </Text>
              );
            })}
          </Text>
        );
      })}
    </View>
  );
}
