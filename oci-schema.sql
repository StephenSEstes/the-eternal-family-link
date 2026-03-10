-- OCI schema bootstrap for application runtime data.
-- Safe to re-run: create statements are wrapped to ignore "already exists" errors.

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE people (
      person_id VARCHAR2(128 CHAR) NOT NULL,
      display_name VARCHAR2(512 CHAR),
      first_name VARCHAR2(256 CHAR),
      middle_name VARCHAR2(256 CHAR),
      last_name VARCHAR2(256 CHAR),
      nick_name VARCHAR2(256 CHAR),
      birth_date VARCHAR2(32 CHAR),
      gender VARCHAR2(32 CHAR),
      phones VARCHAR2(1024 CHAR),
      email VARCHAR2(320 CHAR),
      address VARCHAR2(2000 CHAR),
      hobbies VARCHAR2(2000 CHAR),
      notes VARCHAR2(4000 CHAR),
      photo_file_id VARCHAR2(512 CHAR),
      is_pinned VARCHAR2(8 CHAR),
      relationships VARCHAR2(4000 CHAR),
      CONSTRAINT pk_people PRIMARY KEY (person_id)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE person_family_groups (
      person_id VARCHAR2(128 CHAR) NOT NULL,
      family_group_key VARCHAR2(128 CHAR) NOT NULL,
      is_enabled VARCHAR2(8 CHAR),
      CONSTRAINT pk_person_family_groups PRIMARY KEY (person_id, family_group_key)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE relationships (
      family_group_key VARCHAR2(128 CHAR),
      rel_id VARCHAR2(256 CHAR) NOT NULL,
      from_person_id VARCHAR2(128 CHAR),
      to_person_id VARCHAR2(128 CHAR),
      rel_type VARCHAR2(64 CHAR),
      CONSTRAINT pk_relationships PRIMARY KEY (rel_id)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE households (
      family_group_key VARCHAR2(128 CHAR),
      household_id VARCHAR2(128 CHAR) NOT NULL,
      husband_person_id VARCHAR2(128 CHAR),
      wife_person_id VARCHAR2(128 CHAR),
      label VARCHAR2(512 CHAR),
      notes VARCHAR2(4000 CHAR),
      wedding_photo_file_id VARCHAR2(512 CHAR),
      CONSTRAINT pk_households PRIMARY KEY (household_id)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE user_access (
      person_id VARCHAR2(128 CHAR),
      role VARCHAR2(32 CHAR),
      user_email VARCHAR2(320 CHAR),
      username VARCHAR2(256 CHAR),
      google_access VARCHAR2(8 CHAR),
      local_access VARCHAR2(8 CHAR),
      is_enabled VARCHAR2(8 CHAR),
      password_hash VARCHAR2(512 CHAR),
      failed_attempts VARCHAR2(32 CHAR),
      locked_until VARCHAR2(64 CHAR),
      must_change_password VARCHAR2(8 CHAR)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE user_family_groups (
      user_email VARCHAR2(320 CHAR) NOT NULL,
      family_group_key VARCHAR2(128 CHAR) NOT NULL,
      family_group_name VARCHAR2(512 CHAR),
      role VARCHAR2(32 CHAR),
      person_id VARCHAR2(128 CHAR),
      is_enabled VARCHAR2(8 CHAR),
      CONSTRAINT pk_user_family_groups PRIMARY KEY (user_email, family_group_key)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE invites (
      invite_id VARCHAR2(128 CHAR) NOT NULL,
      family_group_key VARCHAR2(128 CHAR),
      person_id VARCHAR2(128 CHAR) NOT NULL,
      invite_email VARCHAR2(320 CHAR) NOT NULL,
      auth_mode VARCHAR2(32 CHAR) NOT NULL,
      role VARCHAR2(32 CHAR),
      local_username VARCHAR2(256 CHAR),
      family_groups_json CLOB,
      status VARCHAR2(32 CHAR),
      token_hash VARCHAR2(128 CHAR) NOT NULL,
      expires_at VARCHAR2(64 CHAR),
      accepted_at VARCHAR2(64 CHAR),
      accepted_by_email VARCHAR2(320 CHAR),
      accepted_auth_mode VARCHAR2(32 CHAR),
      created_at VARCHAR2(64 CHAR),
      created_by_email VARCHAR2(320 CHAR),
      created_by_person_id VARCHAR2(128 CHAR),
      CONSTRAINT pk_invites PRIMARY KEY (invite_id)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE family_config (
      family_group_key VARCHAR2(128 CHAR) NOT NULL,
      family_group_name VARCHAR2(512 CHAR),
      viewer_pin_hash VARCHAR2(512 CHAR),
      photos_folder_id VARCHAR2(512 CHAR),
      CONSTRAINT pk_family_config PRIMARY KEY (family_group_key)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE family_security_policy (
      family_group_key VARCHAR2(128 CHAR) NOT NULL,
      id VARCHAR2(128 CHAR) NOT NULL,
      min_length VARCHAR2(32 CHAR),
      require_number VARCHAR2(8 CHAR),
      require_uppercase VARCHAR2(8 CHAR),
      require_lowercase VARCHAR2(8 CHAR),
      lockout_attempts VARCHAR2(32 CHAR),
      CONSTRAINT pk_family_security_policy PRIMARY KEY (family_group_key, id)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE person_attributes (
      attribute_id VARCHAR2(128 CHAR) NOT NULL,
      person_id VARCHAR2(128 CHAR),
      attribute_type VARCHAR2(128 CHAR),
      value_text VARCHAR2(4000 CHAR),
      value_json VARCHAR2(4000 CHAR),
      media_metadata VARCHAR2(4000 CHAR),
      label VARCHAR2(512 CHAR),
      is_primary VARCHAR2(8 CHAR),
      sort_order VARCHAR2(32 CHAR),
      start_date VARCHAR2(32 CHAR),
      end_date VARCHAR2(32 CHAR),
      visibility VARCHAR2(64 CHAR),
      share_scope VARCHAR2(64 CHAR),
      share_family_group_key VARCHAR2(128 CHAR),
      notes VARCHAR2(4000 CHAR),
      CONSTRAINT pk_person_attributes PRIMARY KEY (attribute_id)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE household_photos (
      family_group_key VARCHAR2(128 CHAR),
      photo_id VARCHAR2(128 CHAR) NOT NULL,
      household_id VARCHAR2(128 CHAR),
      file_id VARCHAR2(512 CHAR),
      name VARCHAR2(512 CHAR),
      description VARCHAR2(4000 CHAR),
      photo_date VARCHAR2(32 CHAR),
      is_primary VARCHAR2(8 CHAR),
      media_metadata VARCHAR2(4000 CHAR),
      CONSTRAINT pk_household_photos PRIMARY KEY (photo_id)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE media_assets (
      media_id VARCHAR2(128 CHAR) NOT NULL,
      file_id VARCHAR2(512 CHAR) NOT NULL,
      storage_provider VARCHAR2(64 CHAR),
      mime_type VARCHAR2(256 CHAR),
      file_name VARCHAR2(512 CHAR),
      file_size_bytes VARCHAR2(32 CHAR),
      media_metadata VARCHAR2(4000 CHAR),
      created_at VARCHAR2(64 CHAR),
      CONSTRAINT pk_media_assets PRIMARY KEY (media_id)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE media_links (
      family_group_key VARCHAR2(128 CHAR) NOT NULL,
      link_id VARCHAR2(128 CHAR) NOT NULL,
      media_id VARCHAR2(128 CHAR) NOT NULL,
      entity_type VARCHAR2(64 CHAR) NOT NULL,
      entity_id VARCHAR2(128 CHAR) NOT NULL,
      usage_type VARCHAR2(64 CHAR),
      label VARCHAR2(512 CHAR),
      description VARCHAR2(4000 CHAR),
      photo_date VARCHAR2(32 CHAR),
      is_primary VARCHAR2(8 CHAR),
      sort_order VARCHAR2(32 CHAR),
      media_metadata VARCHAR2(4000 CHAR),
      created_at VARCHAR2(64 CHAR),
      CONSTRAINT pk_media_links PRIMARY KEY (link_id)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE important_dates (
      id VARCHAR2(128 CHAR) NOT NULL,
      date_value VARCHAR2(32 CHAR),
      title VARCHAR2(512 CHAR),
      description VARCHAR2(4000 CHAR),
      person_id VARCHAR2(128 CHAR),
      share_scope VARCHAR2(64 CHAR),
      share_family_group_key VARCHAR2(128 CHAR),
      CONSTRAINT pk_important_dates PRIMARY KEY (id)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE audit_log (
      event_id VARCHAR2(128 CHAR) NOT NULL,
      timestamp VARCHAR2(64 CHAR),
      actor_email VARCHAR2(320 CHAR),
      actor_person_id VARCHAR2(128 CHAR),
      action VARCHAR2(128 CHAR),
      entity_type VARCHAR2(128 CHAR),
      entity_id VARCHAR2(256 CHAR),
      family_group_key VARCHAR2(128 CHAR),
      status VARCHAR2(32 CHAR),
      details VARCHAR2(4000 CHAR),
      CONSTRAINT pk_audit_log PRIMARY KEY (event_id)
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_relationships_from_person ON relationships (from_person_id)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_relationships_to_person ON relationships (to_person_id)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_households_family_group ON households (family_group_key)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_person_attributes_person ON person_attributes (person_id)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX ux_media_assets_file_id ON media_assets (file_id)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_media_links_family_entity ON media_links (family_group_key, entity_type, entity_id)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_media_links_media_id ON media_links (media_id)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_media_links_primary ON media_links (entity_type, entity_id, usage_type, is_primary)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_important_dates_person ON important_dates (person_id)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_user_family_groups_email ON user_family_groups (user_email)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_user_family_groups_person ON user_family_groups (person_id)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_user_family_groups_family ON user_family_groups (family_group_key)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_user_access_person ON user_access (person_id)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_user_access_username ON user_access (username)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX ux_invites_token_hash ON invites (token_hash)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_invites_email_status ON invites (invite_email, status)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_invites_person_status ON invites (person_id, status)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_person_family_groups_family ON person_family_groups (family_group_key)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN
      RAISE;
    END IF;
END;
/
