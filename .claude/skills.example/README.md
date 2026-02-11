# Local Skills Directory

This directory serves as an example for creating your own local Claude Code skills.

## Usage

1. Copy this directory to `.claude/skills/`
2. Modify or add your own custom skills
3. Your local skills will be automatically ignored by git

## Example Skills Structure

```
.claude/skills/
├── my-custom-skill.md          # Your custom skill
├── project-specific-helper.md  # Project-specific utilities
└── debugging-tools.md          # Debugging and analysis tools
```

## Creating Skills

Each skill should be a markdown file with the skill definition. See the Claude Code documentation for details on skill syntax and capabilities.

**Note**: Local skills in `.claude/skills/` are automatically ignored by git to keep your personal tools private.