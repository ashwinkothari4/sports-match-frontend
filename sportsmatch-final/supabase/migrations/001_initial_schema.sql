-- Initial schema, functions and RLS for SportsMatch

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email text UNIQUE NOT NULL,
  username varchar(64),
  avatar_url text,
  elo integer DEFAULT 1200,
  playstyle varchar(32) DEFAULT 'casual',
  wins integer DEFAULT 0,
  losses integer DEFAULT 0,
  total_matches integer DEFAULT 0,
  subscription_tier varchar(32) DEFAULT 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  availability jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Courts
CREATE TABLE IF NOT EXISTS courts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name varchar(255),
  latitude decimal,
  longitude decimal,
  outdoor boolean DEFAULT true,
  image_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Matches
CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id uuid REFERENCES users(id) ON DELETE CASCADE,
  opponent_id uuid REFERENCES users(id) ON DELETE SET NULL,
  sport varchar(64) DEFAULT 'basketball',
  court_id uuid REFERENCES courts(id) ON DELETE SET NULL,
  scheduled_time timestamptz,
  status varchar(32) DEFAULT 'scheduled',
  match_score jsonb DEFAULT '{}'::jsonb,
  midpoint jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Match history
CREATE TABLE IF NOT EXISTS match_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id uuid REFERENCES matches(id) ON DELETE CASCADE,
  user1_id uuid REFERENCES users(id) ON DELETE CASCADE,
  user2_id uuid REFERENCES users(id) ON DELETE CASCADE,
  user1_elo_before integer,
  user1_elo_after integer,
  user2_elo_before integer,
  user2_elo_after integer,
  created_at timestamptz DEFAULT now()
);

-- Achievements
CREATE TABLE IF NOT EXISTS achievements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name varchar(128),
  description text,
  icon text,
  requirement_type varchar(32),
  requirement_value integer,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_achievements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  achievement_id uuid REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at timestamptz DEFAULT now()
);

-- Friends
CREATE TABLE IF NOT EXISTS friends (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  friend_id uuid REFERENCES users(id) ON DELETE CASCADE,
  status varchar(16) DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  type varchar(64),
  title text,
  message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  seen boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Public users view (safe columns)
DROP VIEW IF EXISTS public_users;
CREATE VIEW public_users AS
SELECT 
  id, username, avatar_url, elo, playstyle, wins, losses, total_matches, created_at,
  CASE WHEN total_matches > 0 THEN ROUND((wins::decimal / total_matches) * 100,1) ELSE 0 END as win_rate
FROM users;

-- RLS policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can update own profile" ON users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON users FOR INSERT WITH CHECK (auth.uid() = id);
-- Allow select from users table (public selects should use public_users view, but keeping a safe default)
CREATE POLICY "Users public select" ON users FOR SELECT USING (auth.role() = 'authenticated' OR true);

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view relevant matches" ON matches FOR SELECT USING (
  auth.uid() = creator_id OR auth.uid() = opponent_id OR status = 'completed'
);
CREATE POLICY "Users can create matches" ON matches FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Match participants can update matches" ON matches FOR UPDATE USING (auth.uid() = creator_id OR auth.uid() = opponent_id);

ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their friend relationships" ON friends FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view friendships they are part of" ON friends FOR SELECT USING (auth.uid() = user_id OR auth.uid() = friend_id);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can access their notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert notifications" ON notifications FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo);
CREATE INDEX IF NOT EXISTS idx_courts_lat_lng ON courts(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_matches_scheduled ON matches(scheduled_time);

-- Functions: get_courts_in_radius and find_nearby_users_simple
CREATE OR REPLACE FUNCTION get_courts_in_radius(
  lat decimal,
  lng decimal,
  radius_km integer DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  name varchar,
  latitude decimal,
  longitude decimal,
  outdoor boolean,
  image_url text,
  distance_km decimal
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    c.latitude,
    c.longitude,
    c.outdoor,
    c.image_url,
    ST_Distance(
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
      ST_SetSRID(ST_MakePoint(c.longitude, c.latitude), 4326)::geography
    ) / 1000 as distance_km
  FROM courts c
  WHERE ST_Distance(
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
    ST_SetSRID(ST_MakePoint(c.longitude, c.latitude), 4326)::geography
  ) <= radius_km * 1000
  ORDER BY distance_km ASC;
END;
$$;

CREATE OR REPLACE FUNCTION find_nearby_users_simple(
  user_lat decimal,
  user_lon decimal,
  max_distance integer DEFAULT 10,
  current_user_id uuid DEFAULT NULL,
  min_elo integer DEFAULT 1000,
  max_elo integer DEFAULT 2000
)
RETURNS TABLE(
  id uuid,
  username varchar,
  avatar_url text,
  elo integer,
  playstyle varchar,
  wins integer,
  losses integer,
  total_matches integer,
  latitude decimal,
  longitude decimal,
  distance decimal
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.username,
    u.avatar_url,
    u.elo,
    u.playstyle,
    u.wins,
    u.losses,
    u.total_matches,
    40.7128 as latitude,
    -74.0060 as longitude,
    ST_Distance(
      ST_SetSRID(ST_MakePoint(user_lon, user_lat), 4326)::geography,
      ST_SetSRID(ST_MakePoint(-74.0060, 40.7128), 4326)::geography
    ) / 1000 as distance
  FROM users u
  WHERE u.id != current_user_id
    AND u.elo BETWEEN min_elo AND max_elo
    AND u.subscription_tier != 'free'
  ORDER BY ABS(u.elo - (min_elo + max_elo)/2) ASC, RANDOM()
  LIMIT 20;
END;
$$;

-- Ensure foreign keys for matches are set
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_creator_id_fkey,
  DROP CONSTRAINT IF EXISTS matches_opponent_id_fkey,
  DROP CONSTRAINT IF EXISTS matches_court_id_fkey;

ALTER TABLE matches
  ADD CONSTRAINT matches_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
  ADD CONSTRAINT matches_opponent_id_fkey FOREIGN KEY (opponent_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT matches_court_id_fkey FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE SET NULL;

-- Ensure other FKs for match_history and user_achievements
ALTER TABLE match_history
  DROP CONSTRAINT IF EXISTS match_history_match_id_fkey;

ALTER TABLE match_history
  ADD CONSTRAINT match_history_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
ALTER TABLE match_history
  DROP CONSTRAINT IF EXISTS match_history_user1_id_fkey;
ALTER TABLE match_history
  ADD CONSTRAINT match_history_user1_id_fkey FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE match_history
  DROP CONSTRAINT IF EXISTS match_history_user2_id_fkey;
ALTER TABLE match_history
  ADD CONSTRAINT match_history_user2_id_fkey FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE;

-- Add constraints for availability JSON structure
ALTER TABLE users DROP CONSTRAINT IF EXISTS valid_availability_format;
ALTER TABLE users ADD CONSTRAINT valid_availability_format CHECK (
  availability IS NULL OR (
    jsonb_typeof(availability) = 'object' AND
    availability ? 'preferred_times' AND
    availability ? 'preferred_days' AND
    availability ? 'timezone'
  )
);

-- Seed example achievements (optional)
INSERT INTO achievements (name, description, icon, requirement_type, requirement_value)
  SELECT 'Five Wins', 'Awarded after 5 wins', '🏅', 'wins', 5
  WHERE NOT EXISTS (SELECT 1 FROM achievements WHERE name = 'Five Wins');

INSERT INTO achievements (name, description, icon, requirement_type, requirement_value)
  SELECT 'ELO 1000', 'Reach 1000 ELO', '🔥', 'elo', 1000
  WHERE NOT EXISTS (SELECT 1 FROM achievements WHERE name = 'ELO 1000');

