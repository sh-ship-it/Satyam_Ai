import json

# Load translations
with open("d:/college/Projects/Satyam/scratch/landing_translations.json", "r", encoding="utf-8") as f:
    translations = json.load(f)

# Load i18n.tsx
filepath = "d:/college/Projects/Satyam/frontend/src/lib/i18n.tsx"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Generate TS code for translations
ts_lines = ["  // ── Landing & About Page translations ────────────────────────────────────────"]
for k, v in translations.items():
    # Escape quotes
    k_esc = k.replace('"', '\\"')
    v_esc = v.replace('"', '\\"')
    ts_lines.append(f'  "{k_esc}": "{v_esc}",')

ts_block = "\n".join(ts_lines) + "\n"

# Insert right after the DICT opening
dict_start = "const DICT: Record<string, string> = {"
if dict_start in content:
    new_content = content.replace(dict_start, f"{dict_start}\n{ts_block}")
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)
    print("Merged successfully!")
else:
    print("Error: DICT start not found!")
