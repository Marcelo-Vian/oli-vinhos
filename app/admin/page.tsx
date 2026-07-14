import type { Metadata } from "next";
import AdminApp from "./AdminApp";
import "./admin.css";
import "./admin-orders.css";

export const metadata: Metadata = { title: "Administração" };

export default function AdminPage() { return <AdminApp />; }
