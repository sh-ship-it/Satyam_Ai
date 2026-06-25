import json

# Define the new keys to add
missing_keys = {
    "Built for investigators,": "ತನಿಖಾಧಿಕಾರಿಗಳಿಗಾಗಿ ನಿರ್ಮಿಸಲಾಗಿದೆ,",
    "engineered for evidence": "ಸಾಕ್ಷ್ಯಕ್ಕಾಗಿ ವಿನ್ಯಾಸಗೊಳಿಸಲಾಗಿದೆ",
    "Technology Stack": "ತಂತ್ರಜ್ಞಾನ ಸ್ಟಾಕ್",
    "AI Digital Forensics": "AI ಡಿಜಿಟಲ್ ಫೋರೆನ್ಸಿಕ್ಸ್",
    "Theme": "ಥೀಮ್",
    "Color Themes": "ಬಣ್ಣದ ಥೀಮ್‌ಗಳು",
    "Professional": "ವೃತ್ತಿಪರ",
    "Switch to Light Mode": "ಲೈಟ್ ಮೋಡ್‌ಗೆ ಬದಲಾಯಿಸಿ",
    "Switch to Dark Mode": "ಡಾರ್ಕ್ ಮೋಡ್‌ಗೆ ಬದಲಾಯಿಸಿ"
}

# Load i18n.tsx
filepath = "d:/college/Projects/Satyam/frontend/src/lib/i18n.tsx"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Generate TS code for translations
ts_lines = ["  // ── Standalone missing keys ────────────────────────────────────────"]
for k, v in missing_keys.items():
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
    print("Missing keys added successfully!")
else:
    print("Error: DICT start not found!")
