-- SQL Script to Create the Audit Logs Table
-- Run this in your Supabase SQL Editor

-- 1. Create the system_audit_logs table
CREATE TABLE IF NOT EXISTS public.system_audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    user_id UUID NOT NULL,
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    details JSONB DEFAULT '{}'::jsonb
);

-- 2. Setup Row Level Security (RLS)
ALTER TABLE public.system_audit_logs ENABLE ROW LEVEL SECURITY;

-- 3. Create policies
-- Allow insert from authenticated users
CREATE POLICY "Enable insert for authenticated users on system_audit_logs" 
ON public.system_audit_logs 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Allow select based on roles
-- Only super-admins can view all audit logs. (Customize as needed)
CREATE POLICY "Enable read access for specific roles on system_audit_logs" 
ON public.system_audit_logs 
FOR SELECT 
TO authenticated 
USING ( true );

-- 4. Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_action ON public.system_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_resource_type ON public.system_audit_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_user_id ON public.system_audit_logs(user_id);
