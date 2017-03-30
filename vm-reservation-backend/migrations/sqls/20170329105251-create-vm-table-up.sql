CREATE TABLE vms (
    host VARCHAR NOT NULL PRIMARY KEY,
    status VARCHAR NOT NULL,
    description VARCHAR,
    contact VARCHAR,
    bookingtime VARCHAR,
    systeminfo VARCHAR,
    ansible_facts VARCHAR
);
