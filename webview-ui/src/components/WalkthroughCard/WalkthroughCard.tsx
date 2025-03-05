import React from "react";
import {
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Button,
  Flex,
  FlexItem,
  Title,
  TitleSizes,
  Divider,
  Panel,
  PanelMain,
  PanelMainBody,
  List,
  ListItem,
  Stack,
  StackItem,
  Label,
  ContentVariants,
  Content,
} from "@patternfly/react-core";
// import {
//   TimesIcon,
//   ArrowRightIcon,
//   InfoCircleIcon,
//   RocketIcon,
//   ExternalLinkAltIcon,
//   BookOpenIcon,
//   CogIcon,
// } from "@patternfly/react-icons";

import TimesIcon from "@patternfly/react-icons/dist/esm/icons/times-icon";
import ArrowRightIcon from "@patternfly/react-icons/dist/esm/icons/arrow-right-icon";
import InfoCircleIcon from "@patternfly/react-icons/dist/esm/icons/info-circle-icon";
import RocketIcon from "@patternfly/react-icons/dist/esm/icons/rocket-icon";
import ExternalLinkAltIcon from "@patternfly/react-icons/dist/esm/icons/external-link-alt-icon";
import BookOpenIcon from "@patternfly/react-icons/dist/esm/icons/book-open-icon";
import CogIcon from "@patternfly/react-icons/dist/esm/icons/cog-icon";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";

interface WalkthroughCardProps {
  onClose: () => void;
}

export const WalkthroughCard: React.FC<WalkthroughCardProps> = ({ onClose }) => {
  const { state, dispatch } = useExtensionStateContext();

  const handleExternalLink = (url: string) => {
    dispatch({ type: "OPEN_EXTERNAL_LINK", payload: { url } });
  };

  return (
    <Card
      style={{
        alignContent: "center",
        alignSelf: "center",
        margin: "auto",
      }}
    >
      <CardHeader
        actions={{
          actions: (
            <Button variant="plain" aria-label="Close" onClick={onClose}>
              <TimesIcon />
            </Button>
          ),
          hasNoOffset: false,
        }}
        style={{ padding: "16px" }}
      >
        <Flex alignItems={{ default: "alignItemsCenter" }}>
          <FlexItem>
            <RocketIcon color="#0066CC" />
          </FlexItem>
          <FlexItem>
            <Title headingLevel="h3" size={TitleSizes.lg}>
              Welcome to Konveyor AI (KAI)
            </Title>
          </FlexItem>
        </Flex>
      </CardHeader>
      <Divider />
      <CardBody>
        <Stack hasGutter>
          <StackItem>
            <Flex>
              <FlexItem spacer={{ default: "spacerSm" }}>
                <InfoCircleIcon color="#0066CC" />
              </FlexItem>
              <FlexItem>
                <Content component={ContentVariants.h4}>Get Started with KAI</Content>
                <Content component={ContentVariants.p}>
                  This extension helps you set up Konveyor AI to analyze and migrate your
                  applications.
                </Content>
              </FlexItem>
            </Flex>
          </StackItem>

          <StackItem>
            <Panel variant="raised">
              <PanelMain>
                <PanelMainBody>
                  <Stack hasGutter>
                    <StackItem>
                      <Content component={ContentVariants.h4}>
                        <Flex
                          alignItems={{ default: "alignItemsCenter" }}
                          spaceItems={{ default: "spaceItemsSm" }}
                        >
                          <FlexItem>
                            <BookOpenIcon />
                          </FlexItem>
                          <FlexItem>Documentation & Resources</FlexItem>
                        </Flex>
                      </Content>
                    </StackItem>
                    <StackItem>
                      <List>
                        <ListItem>
                          <Button
                            variant="link"
                            isInline
                            icon={<ExternalLinkAltIcon />}
                            iconPosition="right"
                            onClick={() =>
                              handleExternalLink(
                                "https://github.com/konveyor/kai/blob/main/docs/scenarios/demo.md",
                              )
                            }
                          >
                            Demo Walkthrough
                          </Button>
                          <Label color="blue" isCompact style={{ marginLeft: "8px" }}>
                            Recommended
                          </Label>
                        </ListItem>
                        <ListItem>
                          <Button
                            variant="link"
                            isInline
                            icon={<ExternalLinkAltIcon />}
                            iconPosition="right"
                            onClick={() =>
                              handleExternalLink(
                                "https://github.com/konveyor/kai/blob/main/docs/configuration.md",
                              )
                            }
                          >
                            IDE Configuration Guide
                          </Button>
                        </ListItem>
                      </List>
                    </StackItem>
                  </Stack>
                </PanelMainBody>
              </PanelMain>
            </Panel>
          </StackItem>

          <StackItem>
            <Panel variant="raised">
              <PanelMain>
                <PanelMainBody>
                  <Flex
                    alignItems={{ default: "alignItemsCenter" }}
                    spaceItems={{ default: "spaceItemsSm" }}
                  >
                    <FlexItem>
                      <CogIcon color="#0066CC" />
                    </FlexItem>
                    <FlexItem>
                      <Content component={ContentVariants.p}>
                        <strong>Note:</strong> This walkthrough will guide you through setting up
                        the extension to use KAI with your preferred LLM provider.
                      </Content>
                    </FlexItem>
                  </Flex>
                </PanelMainBody>
              </PanelMain>
            </Panel>
          </StackItem>
        </Stack>
      </CardBody>
      <CardFooter>
        <Button
          variant="plain"
          isBlock
          onClick={() => dispatch({ type: "OPEN_EXTENSION_WALKTHROUGH", payload: {} })}
          icon={<ArrowRightIcon />}
          iconPosition="right"
        >
          Start Walkthrough
        </Button>
      </CardFooter>
    </Card>
  );
};

export default WalkthroughCard;
