import "./violations.css";
import React, { useState } from "react";
import {
  Dropdown,
  DropdownItem,
  DropdownList,
  MenuToggle,
  MenuToggleElement,
} from "@patternfly/react-core";
import { EllipsisVIcon } from "@patternfly/react-icons";

interface ViolationActionsDropdownProps {
  onGetAllSolutions: () => void;
  fixMessage: string;
}

const ViolationActionsDropdown: React.FC<ViolationActionsDropdownProps> = ({
  onGetAllSolutions,
  fixMessage,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleDropdown = () => {
    setIsOpen((prevIsOpen) => !prevIsOpen);
  };

  return (
    <Dropdown
      className="violation-actions-dropdown"
      isOpen={isOpen}
      onSelect={() => setIsOpen(false)}
      onOpenChange={(flag) => setIsOpen(flag)}
      popperProps={{
        appendTo: document.body,
        position: "right",
        direction: "up",
        enableFlip: true,
      }}
      toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
        <MenuToggle
          ref={toggleRef}
          onClick={toggleDropdown}
          isExpanded={isOpen}
          aria-label="Incidents actions"
          variant="plain"
          icon={<EllipsisVIcon />}
        />
      )}
    >
      <DropdownList>
        <DropdownItem onClick={onGetAllSolutions}>{fixMessage}</DropdownItem>
      </DropdownList>
    </Dropdown>
  );
};

export default ViolationActionsDropdown;
