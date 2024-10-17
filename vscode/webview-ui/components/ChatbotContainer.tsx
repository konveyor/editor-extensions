import React from "react";

import { Bullseye, DropdownList, DropdownItem } from "@patternfly/react-core";

import Chatbot, { ChatbotDisplayMode } from "@patternfly/virtual-assistant/dist/dynamic/Chatbot";
import ChatbotContent from "@patternfly/virtual-assistant/dist/dynamic/ChatbotContent";
import ChatbotWelcomePrompt from "@patternfly/virtual-assistant/dist/dynamic/ChatbotWelcomePrompt";
import ChatbotFooter, {
  ChatbotFootnote,
} from "@patternfly/virtual-assistant/dist/dynamic/ChatbotFooter";
import MessageBar from "@patternfly/virtual-assistant/dist/dynamic/MessageBar";
import MessageBox from "@patternfly/virtual-assistant/dist/dynamic/MessageBox";
import Message, { MessageProps } from "@patternfly/virtual-assistant/dist/dynamic/Message";
import ChatbotConversationHistoryNav, {
  Conversation,
} from "@patternfly/virtual-assistant/dist/dynamic/ChatbotConversationHistoryNav";
import ChatbotHeader, {
  ChatbotHeaderMenu,
  ChatbotHeaderMain,
  ChatbotHeaderTitle,
  ChatbotHeaderActions,
  ChatbotHeaderSelectorDropdown,
} from "@patternfly/virtual-assistant/dist/dynamic/ChatbotHeader";

// import PFHorizontalLogoColor from "../ChatbotHeader/PF-HorizontalLogo-Color.svg";
// import PFHorizontalLogoReverse from "../ChatbotHeader/PF-HorizontalLogo-Reverse.svg";

const footnoteProps = {
  label: "Lightspeed uses AI. Check for mistakes.",
  popover: {
    title: "Verify accuracy",
    description: `While Lightspeed strives for accuracy, there's always a possibility of errors. It's a good practice to verify critical information from reliable sources, especially if it's crucial for decision-making or actions.`,
    bannerImage: {
      src: "https://cdn.dribbble.com/userupload/10651749/file/original-8a07b8e39d9e8bf002358c66fce1223e.gif",
      alt: "Example image for footnote popover",
    },
    cta: {
      label: "Got it",
      onClick: () => {
        alert("Do something!");
      },
    },
    link: {
      label: "Learn more",
      url: "https://www.redhat.com/",
    },
  },
};

const markdown = `A paragraph with *emphasis* and **strong importance**.

> A block quote with ~strikethrough~ and a URL: https://reactjs.org.

Here is an inline code - \`() => void\`

Here is some YAML code:

~~~yaml
apiVersion: helm.openshift.io/v1beta1/
kind: HelmChartRepository
metadata:
  name: azure-sample-repo0oooo00ooo
spec:
  connectionConfig:
  url: https://raw.githubusercontent.com/Azure-Samples/helm-charts/master/docs
~~~

Here is some JavaScript code:

~~~js
import React from 'react';

const MessageLoading = () => (
  <div className="pf-chatbot__message-loading">
    <span className="pf-chatbot__message-loading-dots">
      <span className="pf-v6-screen-reader">Loading message</span>
    </span>
  </div>
);

export default MessageLoading;

~~~
`;

const initialMessages: MessageProps[] = [
  {
    role: "user",
    content: "Hello, can you give me an example of what you can do?",
    name: "User",
  },
  {
    role: "bot",
    content: markdown,
    name: "Bot",
    actions: {
      positive: { onClick: () => console.log("Good response") },

      negative: { onClick: () => console.log("Bad response") },

      copy: { onClick: () => console.log("Copy") },

      share: { onClick: () => console.log("Share") },

      listen: { onClick: () => console.log("Listen") },
    },
  },
];

const welcomePrompts = [
  {
    title: "Topic 1",
    message: "Helpful prompt for Topic 1",
  },
  {
    title: "Topic 2",
    message: "Helpful prompt for Topic 2",
  },
];

const initialConversations = {
  Today: [{ id: "1", text: "Hello, can you give me an example of what you can do?" }],
  "This month": [
    {
      id: "2",
      text: "Enterprise Linux installation and setup",
    },
    { id: "3", text: "Troubleshoot system crash" },
  ],
  March: [
    { id: "4", text: "Ansible security and updates" },
    { id: "5", text: "Red Hat certification" },
    { id: "6", text: "Lightspeed user documentation" },
  ],
  February: [
    { id: "7", text: "Crashing pod assistance" },
    { id: "8", text: "OpenShift AI pipelines" },
    { id: "9", text: "Updating subscription plan" },
    { id: "10", text: "Red Hat licensing options" },
  ],
  January: [
    { id: "11", text: "RHEL system performance" },
    { id: "12", text: "Manage user accounts" },
  ],
};

export const ChatbotContainer: React.FunctionComponent = () => {
  const [messages, setMessages] = React.useState<MessageProps[]>(initialMessages);
  const [selectedModel, setSelectedModel] = React.useState("Granite 7B");
  const [isSendButtonDisabled, setIsSendButtonDisabled] = React.useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);
  const [conversations, setConversations] = React.useState<
    Conversation[] | { [key: string]: Conversation[] }
  >(initialConversations);
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const scrollToBottomRef = React.useRef<HTMLDivElement>(null);
  const displayMode = ChatbotDisplayMode.embedded;
  // Autu-scrolls to the latest message
  React.useEffect(() => {
    // don't scroll the first load - in this demo, we know we start with two messages
    if (messages.length > 2) {
      scrollToBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const onSelectModel = (
    _event: React.MouseEvent<Element, MouseEvent> | undefined,
    value: string | number | undefined,
  ) => {
    setSelectedModel(value as string);
  };

  const handleSend = (message: string) => {
    setIsSendButtonDisabled(true);
    const newMessages: MessageProps[] = [];
    // we can't use structuredClone since messages contains functions, but we can't mutate
    // items that are going into state or the UI won't update correctly
    messages.forEach((message) => newMessages.push(message));
    newMessages.push({ role: "user", content: message, name: "User" });
    newMessages.push({
      role: "bot",
      content: "API response goes here",
      name: "bot",
      isLoading: true,
    });
    setMessages(newMessages);

    // this is for demo purposes only; in a real situation, there would be an API response we would wait for
    setTimeout(() => {
      const loadedMessages: MessageProps[] = [];
      // we can't use structuredClone since messages contains functions, but we can't mutate
      // items that are going into state or the UI won't update correctly
      newMessages.forEach((message) => loadedMessages.push(message));
      loadedMessages.pop();
      loadedMessages.push({
        role: "bot",
        content: "API response goes here",
        name: "bot",
        isLoading: false,
        actions: {
          positive: { onClick: () => console.log("Good response") },

          negative: { onClick: () => console.log("Bad response") },

          copy: { onClick: () => console.log("Copy") },

          share: { onClick: () => console.log("Share") },

          listen: { onClick: () => console.log("Listen") },
        },
      });
      setMessages(loadedMessages);
      setIsSendButtonDisabled(false);
    }, 5000);
  };

  const findMatchingItems = (targetValue: string) => {
    let filteredConversations = Object.entries(initialConversations).reduce((acc, [key, items]) => {
      const filteredItems = items.filter((item) =>
        item.text.toLowerCase().includes(targetValue.toLowerCase()),
      );
      if (filteredItems.length > 0) {
        // acc[key] = filteredItems;
      }
      return acc;
    }, {});

    // append message if no items are found
    if (Object.keys(filteredConversations).length === 0) {
      filteredConversations = [{ id: "13", noIcon: true, text: "No results found" }];
    }
    return filteredConversations;
  };

  const horizontalLogo = (
    <Bullseye>
      {/* <Brand className="show-light" src={PFHorizontalLogoColor} alt="PatternFly" />
      <Brand className="show-dark" src={PFHorizontalLogoReverse} alt="PatternFly" /> */}
    </Bullseye>
  );

  return (
    <Chatbot displayMode={displayMode}>
      <ChatbotConversationHistoryNav
        displayMode={displayMode}
        setIsDrawerOpen={setIsDrawerOpen}
        onDrawerToggle={() => {
          setIsDrawerOpen(!isDrawerOpen);
          setConversations(initialConversations);
        }}
        isDrawerOpen={isDrawerOpen}
        activeItemId="1"
        onSelectActiveItem={(e, selectedItem) =>
          console.log(`Selected history item with id ${selectedItem}`)
        }
        conversations={conversations}
        onNewChat={() => {
          setIsDrawerOpen(!isDrawerOpen);
          setMessages([]);
          setConversations(initialConversations);
        }}
        handleTextInputChange={(value: string) => {
          if (value === "") {
            setConversations(initialConversations);
          }
          // this is where you would perform search on the items in the drawer
          // and update the state
          const newConversations: { [key: string]: Conversation[] } = findMatchingItems(value);
          setConversations(newConversations);
        }}
        drawerContent={
          <>
            <ChatbotHeader>
              <ChatbotHeaderMain>
                <ChatbotHeaderMenu
                  aria-expanded={isDrawerOpen}
                  onMenuToggle={() => setIsDrawerOpen(!isDrawerOpen)}
                />
                <ChatbotHeaderTitle>{horizontalLogo}</ChatbotHeaderTitle>
              </ChatbotHeaderMain>
              <ChatbotHeaderActions>
                <ChatbotHeaderSelectorDropdown value={selectedModel} onSelect={onSelectModel}>
                  <DropdownList>
                    <DropdownItem value="Granite 7B" key="granite">
                      Granite 7B
                    </DropdownItem>
                    <DropdownItem value="Llama 3.0" key="llama">
                      Llama 3.0
                    </DropdownItem>
                    <DropdownItem value="Mistral 3B" key="mistral">
                      Mistral 3B
                    </DropdownItem>
                  </DropdownList>
                </ChatbotHeaderSelectorDropdown>
              </ChatbotHeaderActions>
            </ChatbotHeader>
            <ChatbotContent>
              <MessageBox>
                <ChatbotWelcomePrompt
                  title="Hello, Chatbot User"
                  description="How may I help you today?"
                  prompts={welcomePrompts}
                />
                {messages.map((message) => (
                  <Message key={message.name} {...message} />
                ))}
                <div ref={scrollToBottomRef}></div>
              </MessageBox>
            </ChatbotContent>
            <ChatbotFooter>
              <MessageBar
                onSendMessage={handleSend}
                hasMicrophoneButton
                isSendButtonDisabled={isSendButtonDisabled}
              />
              <ChatbotFootnote {...footnoteProps} />
            </ChatbotFooter>
          </>
        }
      ></ChatbotConversationHistoryNav>
    </Chatbot>
  );
};
