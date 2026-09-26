-- Constraint checks for schema.sql. Run against an empty database after loading the schema, via
-- `pnpm --filter @wasselne/api run db:check-schema` (also runs in CI). Every expect_fail check must
-- be rejected by the database with the stated SQLSTATE; a statement that succeeds, or fails for a
-- different reason, RAISES EXCEPTION so the whole run (and the process) fails.
BEGIN;
INSERT INTO accounts(id, phone_e164) VALUES
 ('00000000-0000-0000-0000-00000000000a','+9613000001'),
 ('00000000-0000-0000-0000-00000000000b','+9613000002'),
 ('00000000-0000-0000-0000-00000000000c','+9613000003');
INSERT INTO rider_profiles(account_id) VALUES ('00000000-0000-0000-0000-00000000000a');
INSERT INTO driver_profiles(account_id,status) VALUES ('00000000-0000-0000-0000-00000000000b','APPROVED'),('00000000-0000-0000-0000-00000000000c','APPROVED');
INSERT INTO vehicles(id,driver_id,base_type,make,model,color,plate,seats) VALUES
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000b','CAR','Toyota','Corolla','White','B1',4),
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000c','CAR','Kia','Rio','Grey','C1',4);
INSERT INTO vehicle_categories(id,code,names,base_type,seats,icon) VALUES ('00000000-0000-0000-0000-0000000000ca','car','{"en":"Car"}','CAR',4,'local_taxi');
-- Phase 4 (A-4-03): offers require an eligible driver, so the fixture drivers are made eligible.
UPDATE driver_profiles SET current_vehicle_id='00000000-0000-0000-0000-0000000000b1' WHERE account_id='00000000-0000-0000-0000-00000000000b';
UPDATE driver_profiles SET current_vehicle_id='00000000-0000-0000-0000-0000000000c1' WHERE account_id='00000000-0000-0000-0000-00000000000c';
UPDATE vehicle_categories SET active=true WHERE id='00000000-0000-0000-0000-0000000000ca';
INSERT INTO driver_category_approvals(driver_id,category_id,vehicle_id,status) VALUES
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000ca','00000000-0000-0000-0000-0000000000b1','APPROVED'),
 ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000ca','00000000-0000-0000-0000-0000000000c1','APPROVED');
INSERT INTO service_zones(id,code,name) VALUES ('00000000-0000-0000-0000-0000000000e1','beirut','Beirut');
INSERT INTO platform_settings_versions(id,settings,status,effective_at,published_by) VALUES ('00000000-0000-0000-0000-0000000000e5','{}','PUBLISHED',now(),'00000000-0000-0000-0000-00000000000a');
INSERT INTO quotes(id,rider_id,category_id,zone_id,pickup,dropoff,route_distance_m,route_duration_s,settings_version_id,expires_at) VALUES
 ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000ca','00000000-0000-0000-0000-0000000000e1','POINT(35.5 33.89)','POINT(35.52 33.9)',3000,600,'00000000-0000-0000-0000-0000000000e5',now()+interval '5 min'),
 ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000ca','00000000-0000-0000-0000-0000000000e1','POINT(35.5 33.89)','POINT(35.52 33.9)',3000,600,'00000000-0000-0000-0000-0000000000e5',now()+interval '5 min');
INSERT INTO rides(id,rider_id,quote_id,request_idempotency_key,category_id,category_snapshot,zone_id,pickup,dropoff,settings_version_id,fare_mode,commission_counted,search_deadline_at) VALUES
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000f1','k1','00000000-0000-0000-0000-0000000000ca','{}','00000000-0000-0000-0000-0000000000e1','POINT(35.5 33.89)','POINT(35.52 33.9)','00000000-0000-0000-0000-0000000000e5','FIXED',false,now()+interval '3 min');
INSERT INTO ride_offers(id,ride_id,driver_id,vehicle_id,attempt_no,driver_attempt_no,ack_deadline_at) VALUES
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b1',1,1,now()+interval '5 s');
COMMIT;

CREATE FUNCTION expect_fail(label text, stmt text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE succeeded boolean := false; got text;
BEGIN
  BEGIN
    EXECUTE stmt;
    succeeded := true;
  EXCEPTION WHEN others THEN
    got := SQLSTATE;
    IF got <> expected_state THEN
      RAISE EXCEPTION 'FAIL: % (rejected with SQLSTATE % but expected %: %)', label, got, expected_state, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: % -> % %', label, got, SQLERRM;
  END;
  IF succeeded THEN
    RAISE EXCEPTION 'FAIL: % (statement succeeded but must be rejected)', label;
  END IF;
END $$;

SELECT expect_fail('second outstanding offer for same ride',
 $$INSERT INTO ride_offers(ride_id,driver_id,vehicle_id,attempt_no,driver_attempt_no,ack_deadline_at) VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000c1',2,1,now())$$, '23505');
SELECT expect_fail('second active ride for same rider',
 $$INSERT INTO rides(rider_id,quote_id,request_idempotency_key,category_id,category_snapshot,zone_id,pickup,dropoff,settings_version_id,fare_mode,commission_counted,search_deadline_at) VALUES ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000f2','k2','00000000-0000-0000-0000-0000000000ca','{}','00000000-0000-0000-0000-0000000000e1','POINT(35.5 33.89)','POINT(35.52 33.9)','00000000-0000-0000-0000-0000000000e5','FIXED',false,now())$$, '23505');
SELECT expect_fail('ACTIVE offer with window other than 3 s',
 $$UPDATE ride_offers SET state='ACTIVE', acknowledged_at=now(), accept_deadline_at=now()+interval '4 s' WHERE id='00000000-0000-0000-0000-0000000000a1'$$, '23514');
-- legal path: ACK then accept
UPDATE ride_offers SET state='ACTIVE', acknowledged_at=clock_timestamp(), accept_deadline_at=acknowledged_at+interval '3 s' WHERE id='00000000-0000-0000-0000-0000000000a1';
UPDATE ride_offers SET state='ACCEPTED', resolved_at=clock_timestamp(), end_reason='ACCEPTED' WHERE id='00000000-0000-0000-0000-0000000000a1';
INSERT INTO ride_assignments(ride_id,driver_id,vehicle_id,offer_id,vehicle_snapshot) VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','{}');
INSERT INTO ride_offers(id,ride_id,driver_id,vehicle_id,attempt_no,driver_attempt_no,ack_deadline_at,state,resolved_at,end_reason) VALUES
 ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000c1',2,1,now(),'EXPIRED',now(),'ACK_TIMEOUT');
SELECT expect_fail('second open assignment for same ride',
 $$INSERT INTO ride_assignments(ride_id,driver_id,vehicle_id,offer_id,vehicle_snapshot) VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a2','{}')$$, '23505');
INSERT INTO ledger_entries(driver_id,currency,amount_minor,entry_type,ride_id,idempotency_key) VALUES ('00000000-0000-0000-0000-00000000000b','USD',-45,'COMMISSION','00000000-0000-0000-0000-0000000000d1','ride:r1:COMMISSION');
SELECT expect_fail('duplicate ledger posting (same idempotency key)',
 $$INSERT INTO ledger_entries(driver_id,currency,amount_minor,entry_type,ride_id,idempotency_key) VALUES ('00000000-0000-0000-0000-00000000000b','USD',-45,'COMMISSION','00000000-0000-0000-0000-0000000000d1','ride:r1:COMMISSION')$$, '23505');
SELECT expect_fail('edit ledger entry', $$UPDATE ledger_entries SET amount_minor=-1$$, 'P0001');
SELECT expect_fail('delete ledger entry', $$DELETE FROM ledger_entries$$, 'P0001');
SELECT expect_fail('enable payment method with no adapter', $$UPDATE payment_methods SET enabled=true WHERE code='whish'$$, '23514');
INSERT INTO ride_events(ride_id,ride_version,to_status,actor_role) VALUES ('00000000-0000-0000-0000-0000000000d1',1,'SEARCHING','RIDER');
SELECT expect_fail('edit ride event history', $$UPDATE ride_events SET reason='x'$$, 'P0001');
SELECT expect_fail('delete ride event history', $$DELETE FROM ride_events$$, 'P0001');
-- Phase 4 (A-4-03): eligibility is enforced for every new outstanding offer.
UPDATE ride_offers SET state='CANCELLED', resolved_at=now(), end_reason='RIDE_CANCELLED' WHERE state IN ('PENDING_ACK','ACTIVE');
UPDATE driver_profiles SET status='SUSPENDED' WHERE account_id='00000000-0000-0000-0000-00000000000c';
SELECT expect_fail('offer to a suspended driver',
 $$INSERT INTO ride_offers(ride_id,driver_id,vehicle_id,attempt_no,driver_attempt_no,ack_deadline_at) VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000c1',9,1,now())$$, 'WE001');
UPDATE driver_profiles SET status='APPROVED' WHERE account_id='00000000-0000-0000-0000-00000000000c';
UPDATE driver_category_approvals SET status='PENDING' WHERE driver_id='00000000-0000-0000-0000-00000000000c';
SELECT expect_fail('offer to a driver whose category is not approved',
 $$INSERT INTO ride_offers(ride_id,driver_id,vehicle_id,attempt_no,driver_attempt_no,ack_deadline_at) VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000c1',9,1,now())$$, 'WE001');
UPDATE driver_category_approvals SET status='APPROVED' WHERE driver_id='00000000-0000-0000-0000-00000000000c';
-- Phase 4 (A-4-11): the vehicle must still fit the category's current seats and minimum year.
UPDATE vehicle_categories SET seats = seats + 50 WHERE id = (SELECT category_id FROM rides WHERE id='00000000-0000-0000-0000-0000000000d1');
SELECT expect_fail('offer when the category now needs more seats than the vehicle has',
 $$INSERT INTO ride_offers(ride_id,driver_id,vehicle_id,attempt_no,driver_attempt_no,ack_deadline_at) VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000c1',9,1,now())$$, 'WE001');
UPDATE vehicle_categories SET seats = seats - 50 WHERE id = (SELECT category_id FROM rides WHERE id='00000000-0000-0000-0000-0000000000d1');
INSERT INTO account_blocks(account_id,applies_to,reason,created_by,effective_at) VALUES ('00000000-0000-0000-0000-00000000000c','{DRIVER}','x','00000000-0000-0000-0000-00000000000a',now());
SELECT expect_fail('offer to a blocked driver',
 $$INSERT INTO ride_offers(ride_id,driver_id,vehicle_id,attempt_no,driver_attempt_no,ack_deadline_at) VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000c1',9,1,now())$$, 'WE001');
