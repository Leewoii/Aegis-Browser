import { Globe, Youtube, Mail, FileText, Circle, RefreshCw } from "lucide-react";
import type { Tab } from "../types";

export function Favicon({ tab }: { tab: Tab }) {
  if (tab.kind === "home") {
    return <Globe size={14} className="tab-favicon globe" />;
  }
  if (tab.kind === "updates") {
    return <RefreshCw size={14} className="tab-favicon generic" />;
  }
  const url = tab.url.toLowerCase();
  if (url.includes("youtube.com") || url.includes("youtu.be")) {
    return <Youtube size={14} className="tab-favicon youtube" />;
  }
  if (url.includes("dribbble.com")) {
    return <Circle size={14} className="tab-favicon dribbble" fill="currentColor" />;
  }
  if (url.includes("mail.google.com") || url.includes("gmail.com")) {
    return <Mail size={14} className="tab-favicon gmail" />;
  }
  if (url.includes("notion.so") || url.includes("notion.site")) {
    return <FileText size={14} className="tab-favicon notion" />;
  }
  return <Globe size={14} className="tab-favicon generic" />;
}
