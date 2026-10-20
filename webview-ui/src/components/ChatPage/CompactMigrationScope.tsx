import React, { useState, useMemo } from "react";
import { EnhancedIncident } from "@editor-extensions/shared";
import { getIncidentFile } from "../../utils/incident";

interface CompactMigrationScopeProps {
  incidents: EnhancedIncident[];
  onIncidentSelect: (incident: EnhancedIncident) => void;
}

interface MessageGroup {
  message: string;
  fileGroups: { fileName: string; incidents: EnhancedIncident[] }[];
}

const CompactMigrationScope: React.FC<CompactMigrationScopeProps> = ({
  incidents,
  onIncidentSelect,
}) => {
  const [expanded, setExpanded] = useState(false);

  const { messageGroups, fileCount, incidentCount } = useMemo(() => {
    const byMessage = new Map<string, EnhancedIncident[]>();
    const uniqueFiles = new Set<string>();

    for (const inc of incidents) {
      const key = inc.message;
      const existing = byMessage.get(key);
      if (existing) {
        existing.push(inc);
      } else {
        byMessage.set(key, [inc]);
      }
      uniqueFiles.add(inc.uri);
    }

    const groups: MessageGroup[] = Array.from(byMessage.entries()).map(([message, incs]) => {
      const byFile = new Map<string, EnhancedIncident[]>();
      for (const inc of incs) {
        const fileName = getIncidentFile(inc);
        const existing = byFile.get(fileName);
        if (existing) {
          existing.push(inc);
        } else {
          byFile.set(fileName, [inc]);
        }
      }
      return {
        message,
        fileGroups: Array.from(byFile.entries()).map(([fileName, fileIncs]) => ({
          fileName,
          incidents: fileIncs,
        })),
      };
    });

    return { messageGroups: groups, fileCount: uniqueFiles.size, incidentCount: incidents.length };
  }, [incidents]);

  return (
    <div className="compact-scope">
      <button
        className="compact-scope__toggle"
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? "Collapse scope details" : "Expand scope details"}
      >
        <span
          className={`compact-scope__chevron ${expanded ? "compact-scope__chevron--open" : ""}`}
        >
          &#9656;
        </span>
        <span className="compact-scope__summary">
          {incidentCount} incident{incidentCount !== 1 ? "s" : ""} across {fileCount} file
          {fileCount !== 1 ? "s" : ""}
        </span>
      </button>

      {expanded && (
        <div className="compact-scope__detail">
          {messageGroups.map((group) => (
            <div key={group.message} className="compact-scope__msg-group">
              <span className="compact-scope__msg" title={group.message}>
                {group.message}
              </span>
              {group.fileGroups.map(({ fileName, incidents: fileIncs }) => (
                <div key={fileName} className="compact-scope__file-group">
                  <span className="compact-scope__filename">{fileName}</span>
                  <ul className="compact-scope__lines">
                    {fileIncs.map((inc) => (
                      <li key={`${inc.uri}-${inc.lineNumber}`}>
                        <button
                          className="compact-scope__link"
                          onClick={() => onIncidentSelect(inc)}
                        >
                          :{inc.lineNumber}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CompactMigrationScope;
