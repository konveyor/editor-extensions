import React from "react";
import {
  List,
  ListItem,
  Button,
  Flex,
  FlexItem,
  ButtonVariant,
} from "@patternfly/react-core";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  TimesCircleIcon,
} from "@patternfly/react-icons";
import { Change } from "@editor-extensions/shared";

interface FileChangesProps {
  changes: Change[];
  onFileClick: (change: Change) => void;
  onApplyFix?: (change: Change) => void;
  onRejectChanges?: (change: Change) => void;
}

export function FileChanges({
  changes,
  onFileClick,
  onApplyFix = () => {},
  onRejectChanges = () => {},
}: FileChangesProps) {
  return (
    <List isPlain>
      {changes.map((change, index) => (
        <ListItem key={index}>
          <Flex alignItems={{ default: "alignItemsCenter" }}>
            <FlexItem grow={{ default: "grow" }}>
              <Flex spaceItems={{ default: "spaceItemsSm" }}>
                <FlexItem>{change.modified}</FlexItem>
                <FlexItem>
                  <ArrowRightIcon className="pf-v5-u-color-200" />
                </FlexItem>
              </Flex>
            </FlexItem>
            <FlexItem>
              <Flex spaceItems={{ default: "spaceItemsSm" }}>
                <FlexItem>
                  <Button
                    variant={ButtonVariant.link}
                    onClick={() => onFileClick(change)}
                    className="pf-v5-u-mr-sm"
                  >
                    View Changes
                  </Button>
                </FlexItem>
                <FlexItem>
                  <Button
                    color="green"
                    variant={ButtonVariant.plain}
                    icon={<CheckCircleIcon color="#d1f1bb" />}
                    onClick={() => onApplyFix(change)}
                    style={{ color: "#3E8635" }}
                    aria-label="Apply fix"
                  />
                </FlexItem>
                <FlexItem>
                  <Button
                    variant={ButtonVariant.plain}
                    icon={<TimesCircleIcon color="#f9a8a8" />}
                    onClick={() => onRejectChanges(change)}
                    className="pf-v5-u-danger-color-100"
                    aria-label="Reject changes"
                  />
                </FlexItem>
              </Flex>
            </FlexItem>
          </Flex>
        </ListItem>
      ))}
    </List>
  );
}
