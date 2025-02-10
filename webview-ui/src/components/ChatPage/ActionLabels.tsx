import "./ActionLabels.css";
import React from "react";
import { Label, Toolbar, ToolbarContent, ToolbarItem } from "@patternfly/react-core";
import { BrainIcon, CodeIcon, SearchIcon } from "@patternfly/react-icons";

interface ActionLabelsProps {
  serverRunning: boolean;
}

const ActionLabels: React.FC<ActionLabelsProps> = ({ serverRunning }) => {
  if (!serverRunning) return null;

  const actions = [
    {
      icon: <CodeIcon />,
      label: "Run analysis ",
      onClick: () => console.log("Code Review clicked"),
    },
    // {
    //   icon: <BrainIcon />,
    //   label: "Explain Code",
    //   onClick: () => console.log("Explain Code clicked"),
    // },
    // {
    //   icon: <SearchIcon />,
    //   label: "Find Issues",
    //   onClick: () => console.log("Find Issues clicked"),
    // },
    // {
    //   icon: <GitBranchIcon />,
    //   label: "Git Help",
    //   onClick: () => console.log("Git Help clicked"),
    // },
    // {
    //   icon: <MessageSquareIcon />,
    //   label: "Ask Question",
    //   onClick: () => console.log("Ask Question clicked"),
    // },
    // {
    //   icon: <LightningBoltIcon />,
    //   label: "Quick Actions",
    //   onClick: () => console.log("Quick Actions clicked"),
    // },
  ];

  return (
    <div className="pf-v6-u-p-md pf-v6-u-background-color-100 pf-v6-u-border-top">
      <Toolbar className="pf-v6-u-justify-content-center">
        <ToolbarContent>
          <ToolbarItem>
            <div className="pf-v6-u-display-flex pf-v6-u-flex-wrap pf-v6-u-gap-sm">
              {actions.map((action) => (
                <Label
                  key={action.label}
                  icon={action.icon}
                  isCompact
                  color="grey"
                  href="#"
                  className="action-label"
                  onClick={(e) => {
                    e.preventDefault();
                    action.onClick();
                  }}
                >
                  {action.label}
                </Label>
              ))}
            </div>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
    </div>
  );
};

export default ActionLabels;
