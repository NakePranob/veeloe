// Package archtest holds the Hub's structure rules (ADR 0070), the check that
// replaced `go-scaffold check`. Each failure prints the rule id from
// .conventions/rules.json and the file, so it leads back to the decision.
package archtest

import (
	"encoding/json"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

const module = "hub"

// Folders that are generated, installed or local, never read.
var skipDirs = map[string]bool{".git": true, "node_modules": true, "vendor": true, "bin": true, "tmp": true}

// What may sit at the Hub root besides files.
var rootDirs = map[string]bool{"cmd": true, "internal": true, "migrations": true, "docs": true, ".conventions": true, ".vscode": true, ".claude": true}

func hubRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		t.Fatalf("no go.mod at %s", root)
	}
	return root
}

// files is every file under the Hub, slash-separated and relative to its root.
func files(t *testing.T, root string) []string {
	t.Helper()
	var out []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if path != root && skipDirs[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		out = append(out, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(out)
	return out
}

func TestStructure(t *testing.T) {
	root := hubRoot(t)
	all := files(t, root)
	fail := func(rule, file, detail string) { t.Errorf("%s: %s: %s", rule, file, detail) }

	checkKnownPlaces(all, fail)
	checkUnitShape(t, root, all, fail)
	checkMigrationPairs(all, fail)
	checkImports(t, root, all, fail)
}

func checkKnownPlaces(all []string, fail func(string, string, string)) {
	for _, file := range all {
		parts := strings.Split(file, "/")
		if len(parts) == 1 {
			continue // a root file
		}
		if !rootDirs[parts[0]] {
			fail("known-places", file, parts[0]+"/ is not a known place")
			continue
		}
		if parts[0] != "internal" {
			continue
		}
		ok := false
		switch {
		case len(parts) >= 4 && parts[1] == "app":
			ok = true // inside a module
		case len(parts) == 3 && (parts[1] == "composition" || parts[1] == "archtest"):
			ok = true
		case len(parts) >= 4 && (parts[1] == "shared" || parts[1] == "platform"):
			ok = true // inside a shared or platform package
		}
		if !ok {
			fail("known-places", file, "not in a module, internal/shared/<pkg>, internal/platform/<pkg>, internal/composition or internal/archtest")
		}
	}
}

// checkUnitShape compares each module's folders with its templates' folders.
func checkUnitShape(t *testing.T, root string, all []string, fail func(string, string, string)) {
	var rules struct {
		Templates []struct {
			Dir string `json:"dir"`
		} `json:"templates"`
	}
	raw, err := os.ReadFile(filepath.Join(root, ".conventions", "rules.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &rules); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{}
	for _, template := range rules.Templates {
		prefix := template.Dir + "/"
		found := false
		for _, file := range all {
			if rest, ok := strings.CutPrefix(file, prefix); ok {
				found = true
				if dir := filepath.ToSlash(filepath.Dir(rest)); dir != "." {
					for d := dir; d != "."; d = filepath.ToSlash(filepath.Dir(d)) {
						allowed[d] = true
					}
				}
			}
		}
		if !found {
			fail("unit-shape", template.Dir, "the template folder is missing")
		}
	}
	for _, file := range all {
		parts := strings.Split(file, "/")
		if len(parts) < 5 || parts[0] != "internal" || parts[1] != "app" {
			continue
		}
		dir := strings.Join(parts[3:len(parts)-1], "/")
		if !allowed[dir] {
			names := make([]string, 0, len(allowed))
			for d := range allowed {
				names = append(names, d)
			}
			sort.Strings(names)
			fail("unit-shape", file, "internal/app/"+parts[2]+"/"+dir+"/ is not a folder its templates have ("+strings.Join(names, ", ")+")")
		}
	}
}

func checkMigrationPairs(all []string, fail func(string, string, string)) {
	have := map[string]bool{}
	for _, file := range all {
		have[file] = true
	}
	for _, file := range all {
		if up, ok := strings.CutSuffix(file, ".up.sql"); ok && strings.HasPrefix(file, "migrations/") {
			if !have[up+".down.sql"] {
				fail("migration-pairs", file, "has no "+filepath.Base(up)+".down.sql")
			}
		}
	}
}

// layer is where a file sits inside its module: domain, application, ports,
// inbound, outbound, or "" for the module root.
func layer(rest []string) string {
	switch {
	case len(rest) >= 2 && rest[0] == "adapters" && rest[1] == "inbound":
		return "inbound"
	case len(rest) >= 2 && rest[0] == "adapters" && rest[1] == "outbound":
		return "outbound"
	case len(rest) >= 1 && (rest[0] == "domain" || rest[0] == "application" || rest[0] == "ports"):
		return rest[0]
	}
	return ""
}

func checkImports(t *testing.T, root string, all []string, fail func(string, string, string)) {
	const app = module + "/internal/app/"
	gin := func(p string) bool {
		return p == "github.com/gin-gonic/gin" || strings.HasPrefix(p, "github.com/gin-gonic/gin/")
	}
	gorm := func(p string) bool { return strings.HasPrefix(p, "gorm.io/") }
	fset := token.NewFileSet()
	for _, file := range all {
		if !strings.HasSuffix(file, ".go") || strings.HasPrefix(file, "internal/archtest/") {
			continue
		}
		parsed, err := parser.ParseFile(fset, filepath.Join(root, file), nil, parser.ImportsOnly)
		if err != nil {
			t.Errorf("%s: does not parse: %v", file, err)
			continue
		}
		parts := strings.Split(file, "/")
		inModule := len(parts) >= 4 && parts[0] == "internal" && parts[1] == "app"
		for _, spec := range parsed.Imports {
			path, _ := strconv.Unquote(spec.Path.Value)

			if parts[0] == "internal" && (path == module+"/cmd" || strings.HasPrefix(path, module+"/cmd/")) {
				fail("no-cmd-import", file, "imports "+path+"; wiring flows inward")
			}

			if rest, ok := strings.CutPrefix(path, app); ok {
				target := strings.SplitN(rest, "/", 2)
				switch {
				case inModule && target[0] != parts[2]:
					fail("module-isolation", file, "module "+parts[2]+" imports module "+target[0]+" ("+path+"); internal/composition wires them")
				case !inModule && parts[0] == "internal" && parts[1] == "composition" && len(target) > 1:
					fail("module-isolation", file, "imports "+path+"; composition imports only a module's root package")
				case !inModule && parts[0] == "internal" && parts[1] != "composition":
					fail("module-isolation", file, "imports module "+target[0]+"; only internal/composition and cmd/ wire modules")
				}
			}

			if !inModule {
				continue
			}
			own := app + parts[2] + "/"
			adapters := strings.HasPrefix(path, own+"adapters/")
			bad := ""
			switch layer(parts[3:]) {
			case "domain":
				if gin(path) || gorm(path) || adapters || strings.HasPrefix(path, own+"application") || strings.HasPrefix(path, own+"ports") {
					bad = "domain"
				}
			case "application", "ports":
				if gin(path) || gorm(path) || adapters {
					bad = layer(parts[3:])
				}
			case "inbound":
				if gorm(path) || strings.HasPrefix(path, own+"adapters/outbound") {
					bad = "an inbound adapter"
				}
			case "outbound":
				if gin(path) || strings.HasPrefix(path, own+"adapters/inbound") {
					bad = "an outbound adapter"
				}
			}
			if bad != "" {
				fail("layer-direction", file, bad+" imports "+path)
			}
		}
	}
}
