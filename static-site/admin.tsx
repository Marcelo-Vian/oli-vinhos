import React from "react";
import { createRoot } from "react-dom/client";
import AdminApp from "../app/admin/AdminApp";
import "../app/globals.css";
import "../app/admin/admin.css";
import "../app/admin/admin-orders.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><AdminApp /></React.StrictMode>);
