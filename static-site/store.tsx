import React from "react";
import { createRoot } from "react-dom/client";
import StoreApp from "../app/components/StoreApp";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><StoreApp /></React.StrictMode>);
