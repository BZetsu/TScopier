```sql
CREATE POLICY "Admins can view all trade reports"
  ON public.trade_reports
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can update trade reports"
  ON public.trade_reports
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMENT ON POLICY "Admins can view all trade reports" ON public.trade_reports IS
  'Admin dashboard Reports page needs full visibility over user-submitted trade reports.';

COMMENT ON POLICY "Admins can update trade reports" ON public.trade_reports IS
  'Admin dashboard Reports page marks reports as resolved.';
```
