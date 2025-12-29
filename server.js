const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const app = express();
const port = 7760;
const cron = require("node-cron");
const axios = require("axios")



// CORS middleware
app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads"))); // serve uploaded files

// Ensure uploads folder exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });
const XLSX = require("xlsx");


// SQLite DB

const db = new sqlite3.Database("./Accounting.db", (err) => {
  if (err) return console.error(err.message);
  console.log("Connected to SQLite database.");

  db.run("PRAGMA journal_mode=WAL;");      // enable WAL
  db.configure("busyTimeout", 5000);       // wait 5 seconds if busy
});
app.locals.db = db;
// const dbPath = path.join(__dirname, "Accounting.db");

// const db = new sqlite3.Database(dbPath, (err) => {
//   if (err) return console.error(err.message);
//   console.log("Connected to SQLite database at:", dbPath);

//   db.run("PRAGMA journal_mode=WAL;");
//   db.configure("busyTimeout", 5000);
// });


db.run(`
CREATE TABLE IF NOT EXISTS ClientsTable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clientName TEXT,
  aboutClient TEXT,
  paymentTerms INTEGER,
  location TEXT,
  contactSpoc TEXT,
  contactEmail TEXT,
  contactNumber TEXT,
  gstApplicable TEXT,
  gstNumber TEXT,
  gstPercentage REAL
)
`);

db.run(
  `CREATE TABLE IF NOT EXISTS Projects (
  projectID TEXT PRIMARY KEY,
  clientID INTEGER NOT NULL,
  startDate TEXT,
  endDate TEXT,
  projectName TEXT,
  projectDescription TEXT,
  skill TEXT,
  projectLocation TEXT,
  spoc TEXT,
  mailID TEXT,
  mobileNo TEXT,
  billingType TEXT,
  billRate REAL,
  monthlyBilling REAL,
  gst INTEGER,
  tds INTEGER,
  netPayable INTEGER,
  employees TEXT, -- ✅ JSON array of employees
  hoursOrDays REAL,
  poNumber TEXT,
  purchaseOrder TEXT,
  purchaseOrderValue REAL,
   isFixed TEXT DEFAULT 'No',     -- ✅ FIX 1
  startMonth TEXT,
  milestones TEXT,  
  active TEXT CHECK(active IN ('Yes','No')),
  invoiceCycle TEXT CHECK(invoiceCycle IN ('Monthly', 'Quarterly')),
  FOREIGN KEY (clientID) REFERENCES Clients(id) ON DELETE CASCADE
);
`
)

// Create employees table if not exists
db.run(`
CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone_number INTEGER,
    skills TEXT,
    resume TEXT,
    photo TEXT,
    ctc TEXT,
    salary_paid TEXT CHECK(salary_paid IN ('Yes','No')),
    billable TEXT CHECK(billable IN ('Yes','No')),
    consultant_regular TEXT CHECK(consultant_regular IN ('Consultant','Regular')),
    active TEXT CHECK(active IN ('Yes','No')),
    project_ending TEXT CHECK(project_ending IN ('Yes','No')),
    date_of_joining TEXT DEFAULT (date('now'))
);
`);


// -- Salary tracking table with deductions and net take-home
db.run(
  `CREATE TABLE IF NOT EXISTS salary_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    employee_name TEXT,
    month TEXT NOT NULL,
    paid TEXT CHECK(paid IN ('Yes','No')) DEFAULT 'No',
    paid_date TEXT,
    
    -- Monthly Salary Components
    basic_pay REAL DEFAULT 0,
    hra REAL DEFAULT 0,
    conveyance_allowance REAL DEFAULT 0,
    medical_allowance REAL DEFAULT 0,
    lta REAL DEFAULT 0,
    personal_allowance REAL DEFAULT 0,
    gross_salary REAL DEFAULT 0,
    ctc REAL DEFAULT 0,
    
    -- Deductions (Employee)
    professional_tax REAL DEFAULT 0,
    insurance REAL DEFAULT 0,
    pf REAL DEFAULT 0,
    tds REAL DEFAULT 0,
    
    -- Deductions (Employer)
    employer_pf REAL DEFAULT 0,
    employer_health_insurance REAL DEFAULT 0,
    
    -- Final
    net_takehome REAL DEFAULT 0,

    -- 🔹 NEW COLUMNS (Totals)
    total_pf REAL DEFAULT 0,
    total_insurance REAL DEFAULT 0,

    FOREIGN KEY(employee_id) REFERENCES employees(employee_id)
  );`
);


// Invoices Table
db.run(`
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL UNIQUE,
    invoice_date TEXT NOT NULL,        -- YYYY-MM-DD
    client_name TEXT NOT NULL,
    project_id TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    invoice_cycle TEXT CHECK(invoice_cycle IN ('Monthly', 'Quarterly')) NOT NULL,
    invoice_value REAL NOT NULL,
    gst_amount REAL NOT NULL,
    due_date TEXT NOT NULL,
    billable_days INTEGER NOT NULL,
    non_billable_days INTEGER,
    received TEXT CHECK(received IN ('Yes','No')) DEFAULT 'No',
    received_date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Monthly Salary Payments Table
db.run(`
  CREATE TABLE IF NOT EXISTS monthly_salary_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    paid TEXT CHECK(paid IN ('Yes','No')) NOT NULL DEFAULT 'No',
    month TEXT NOT NULL, -- Format: YYYY-MM
    lop REAL DEFAULT 0, -- Loss of Pay
    paid_amount REAL DEFAULT 0,
    actual_to_pay REAL DEFAULT 0,
    paid_date TEXT,
    due_date TEXT,
    FOREIGN KEY(employee_id) REFERENCES salary_payments(employee_id) ON UPDATE CASCADE ON DELETE CASCADE
  );
`);

// Expenses DB
db.run(`
  CREATE TABLE IF NOT EXISTS expenses (
    auto_id INTEGER PRIMARY KEY AUTOINCREMENT,
    regular TEXT CHECK(regular IN ('Yes','No')),
    type TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL, -- Expected expense amount
    currency TEXT DEFAULT 'INR',
    raised_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    paid_date TEXT,
    paid_amount REAL,
    Active TEXT,
    status TEXT CHECK(status IN ('Raised','Paid','Cancelled')) DEFAULT 'Raised'
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS expense_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id INTEGER NOT NULL,
    month_year TEXT NOT NULL,
    actual_amount REAL NOT NULL,
    paid_amount REAL,
    paid_date TEXT,
    status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending','Paid','Raised','In Process','Hold','Rejected')),
    remarks TEXT,
    due_date TEXT,
    FOREIGN KEY (expense_id) REFERENCES expenses(auto_id),
    UNIQUE(expense_id, month_year)
  );
`);

// 1️⃣ Accounts Table
db.run(`
  CREATE TABLE IF NOT EXISTS accounts (
    account_id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_number TEXT UNIQUE NOT NULL,
    account_name TEXT NOT NULL,
    account_type TEXT CHECK(account_type IN ('Capital','Current')) NOT NULL,
    balance REAL DEFAULT 0,
    is_hidden INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// 2️⃣ Transactions Table
db.run(`
  CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  account_number TEXT NOT NULL,
  type TEXT CHECK(type IN ('Credit','Debit','Transfer')) NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  previous_balance REAL NOT NULL,  -- ✅ balance before transaction
  updated_balance REAL NOT NULL,   -- ✅ balance after transaction
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(account_number) REFERENCES accounts(account_number)
);

`);
function generateMonthRange(start, end) {
  const startDate = new Date(start + "-01");
  const endDate = new Date(end + "-01");
  const months = [];

  while (startDate <= endDate) {
    months.push(startDate.toISOString().slice(0, 7));
    startDate.setMonth(startDate.getMonth() + 1);
  }

  return months;
}
function runQuery(query) {
  return new Promise((resolve, reject) => {
    db.all(query, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}
// GET clients
app.get("/getclients", (req, res) => {
  db.all("SELECT * FROM ClientsTable", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
app.get("/getclient/:id", (req, res) => {
  db.get(
    "SELECT * FROM ClientsTable WHERE id = ?",
    [req.params.id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Client not found" });
      res.json(row);
    }
  );
});

// POST add client
app.post("/addclients", (req, res) => {
  console.log(req.body);
  const {
    clientName,
    aboutClient,
    paymentTerms,
    location,
    contactSpoc,
    contactEmail,
    contactNumber,
    gstApplicable,
    gstNumber,
    gstPercentage,
  } = req.body;
db.serialize(() => {
  db.run(
    `INSERT INTO ClientsTable 
      ( clientName, aboutClient, paymentTerms, location, contactSpoc, contactEmail, contactNumber, gstApplicable, gstNumber, gstPercentage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      clientName,
      aboutClient,
      paymentTerms,
      location,
      contactSpoc,
      contactEmail,
      contactNumber,
      gstApplicable,
      gstNumber,
      gstPercentage,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

});
// -------- ADD PROJECT API --------
function generateRandomNumber(length = 6) {
  return Math.floor(Math.random() * Math.pow(10, length))
    .toString()
    .padStart(length, "0");
}

function getUniqueProjectID(db, clientID, projectName, callback) {
  const prefix = `${clientID}${projectName.substring(0, 3).toUpperCase()}`;
  const tryID = `${prefix}${generateRandomNumber(6)}`;

  db.get("SELECT projectID FROM Projects WHERE projectID = ?", [tryID], (err, row) => {
    if (err) return callback(err, null);
    if (row) {
      // If ID exists, try again
      getUniqueProjectID(db, clientID, projectName, callback);
    } else {
      callback(null, tryID);
    }
  });
}
app.post("/addproject", upload.single("purchaseOrder"), (req, res) => {
  const {
    clientID,
    startDate,
    endDate,
    projectName,
    projectDescription,
    skill,
    projectLocation,
    spoc,
    mailID,
    mobileNo,
    billingType,
    billRate,
    monthlyBilling,
    gst,
    tds,
    netPayable,
    employees,
    hoursOrDays,
    poNumber,
    purchaseOrderValue,
    active,
    invoiceCycle,

    // ✅ Fixed project fields
    isFixed,
    startMonth,   // 🔹 optional now
    milestones,
  } = req.body;

  const purchaseOrderFile = req.file ? req.file.filename : null;

  if (!clientID || !projectName) {
    return res.status(400).json({
      error: "Client and Project Name are required",
    });
  }

  getUniqueProjectID(db, clientID, projectName, (err, uniqueID) => {
    if (err) {
      return res.status(500).json({ error: "Failed to generate project ID" });
    }

    /* ===============================
       🔹 Parse employees
    =============================== */
    let employeesData = [];
    try {
      employeesData =
        typeof employees === "string" ? JSON.parse(employees) : employees || [];
    } catch {
      employeesData = [];
    }

    /* ===============================
       🔹 Parse milestones (only if Fixed)
    =============================== */
    let milestonesData = [];

    if (isFixed === "Yes") {
      try {
        milestonesData =
          typeof milestones === "string"
            ? JSON.parse(milestones)
            : milestones || [];
      } catch {
        milestonesData = [];
      }
    }

    const query = `
      INSERT INTO Projects (
        projectID, clientID, startDate, endDate,
        projectName, projectDescription, skill, projectLocation,
        spoc, mailID, mobileNo,
        billingType, billRate, monthlyBilling,
        gst, tds, netPayable,
        employees, hoursOrDays,
        poNumber, purchaseOrder, purchaseOrderValue,
        active, invoiceCycle,
        isFixed, startMonth, milestones
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(
      query,
      [
        uniqueID,
        clientID,
        startDate || null,
        endDate || null,
        projectName,
        projectDescription || "",
        skill || "",
        projectLocation || "",
        spoc || "",
        mailID || "",
        mobileNo || "",
        billingType || "",
        billRate || 0,
        monthlyBilling || 0,
        gst || 0,
        tds || 0,
        netPayable || 0,
        JSON.stringify(employeesData),
        hoursOrDays || 0,
        poNumber || "NA",
        purchaseOrderFile,
        purchaseOrderValue || "NA",
        active || "Yes",
        invoiceCycle || "Monthly",

        // ✅ Fixed project (safe defaults)
        isFixed || "No",
        startMonth || null,                // ✅ optional
        JSON.stringify(milestonesData),    // ✅ always JSON
      ],
      function (err) {
        if (err) {
          console.error("❌ Add Project Error:", err.message);
          return res.status(500).json({ error: err.message });
        }

        res.json({
          success: true,
          projectID: uniqueID,
          message: "Project added successfully",
        });
      }
    );
  });
});
app.get("/getprojects", (req, res) => {
  db.all("SELECT * FROM Projects", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all("SELECT employee_id, employee_name FROM employees", [], (err2, emps) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const empMap = new Map(emps.map(e => [e.employee_id, e.employee_name]));

      const formatted = rows.map(row => {
        let employees = [];
        try {
          const arr = JSON.parse(row.employees || "[]");
          employees = arr.map(emp => ({
            id: typeof emp === "string" ? emp : emp.id,
            name:
              typeof emp === "string"
                ? empMap.get(emp) || emp
                : emp.name,
          }));
        } catch {
          employees = [];
        }

        let milestones = [];
        try {
          milestones = row.milestones
            ? JSON.parse(row.milestones)
            : [];
        } catch {
          milestones = [];
        }

        return {
          ...row,
          employees,
          milestones,
        };
      });

      res.json(formatted);
    });
  });
});
// POST API (add new employee)
app.post("/postemployees",
  upload.fields([{ name: "resume" }, { name: "photo" }]),
  (req, res) => {
    const {
      employee_id,
      employee_name,
      email,
      phone_number,
      skills,
      ctc,
      billable,
      consultant_regular,
      active,
      project_ending,
      date_of_joining
    } = req.body;

    const resume = req.files["resume"] ? req.files["resume"][0].path : null;
    const photo = req.files["photo"] ? req.files["photo"][0].path : null;

   db.run(
  `INSERT INTO employees 
  (employee_id, employee_name, email, phone_number, skills, ctc, resume, photo, salary_paid, billable, consultant_regular, active, project_ending,date_of_joining) 
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)`,
  [
    employee_id,
    employee_name,
    email,
    phone_number,
    skills,
    ctc,                  // ✅ CTC
    resume,               // ✅ Resume path
    photo,                // ✅ Photo path
    "No",                 // ✅ salary_paid default
    billable,             // ✅ Billable ("Yes" or "No")
    consultant_regular,
    active,
    project_ending,
    date_of_joining
  ],
  function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      console.log(err);
    } else {
      res.json({ id: this.lastID, message: "Employee added successfully" });
    }
  }
);

  }
);

// GET API (fetch all employees)
app.get("/getemployees", (req, res) => {
  db.all("SELECT * FROM employees", [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// GET AVailable Employees for Projects
app.get("/getAvailableEmployees", (req, res) => {
  db.all(`SELECT employee_id, employee_name FROM employees`, [], (err, allEmployees) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all(`SELECT employees FROM Projects WHERE employees IS NOT NULL`, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      const assigned = new Set();

      rows.forEach(row => {
        try {
          const parsed = JSON.parse(row.employees || "[]");
          parsed.forEach(emp => {
            if (typeof emp === "string") assigned.add(emp);
            else if (emp.id) assigned.add(emp.id);
          });
        } catch (e) {
          console.error("JSON parse error:", e);
        }
      });

      const available = allEmployees.filter(emp => !assigned.has(emp.employee_id));
      res.json(available);
    });
  });
});
// ✅ GET all salaries
app.get("/getallsalaries", (req, res) => {
  db.all(`SELECT * FROM salary_payments`, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});
// 💰 Add Salary + create related expenses
app.post("/addsalaries", (req, res) => {
  console.log("➡️ /addsalaries body:", req.body);

  const {
    employee_id,
    employee_name,
    month,          // expected: "YYYY-MM"
    paid,
    paid_date,

    basic_pay,
    hra,
    conveyance_allowance,
    medical_allowance,
    lta,
    personal_allowance,
    gross_salary,
    ctc,

    professional_tax,
    insurance,                  // employee insurance (monthly)
    pf,                         // employee PF (monthly)
    tds,                        // TDS (monthly)

    employer_pf,                // employer PF (monthly)
    employer_health_insurance,  // employer insurance (monthly)

    net_takehome,
  } = req.body;

  // 🔹 Basic validation
  if (!employee_id || !month) {
    console.error("❌ Missing employee_id or month in /addsalaries");
    return res
      .status(400)
      .json({ error: "employee_id and month are required" });
  }

  // 👉 Helpers based on selected salary month (YYYY-MM)
  function getLastDayOfMonth(ym) {
    const [year, m] = ym.split("-").map(Number);        // "2025-01" -> [2025, 1]
    const last = new Date(year, m, 0).getDate();        // day 0 of next month = last day of given month
    return `${year}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  }

  function getSeventhOfNextMonth(ym) {
    const [year, m] = ym.split("-").map(Number);
    const nextMonth = m + 1 > 12 ? 1 : m + 1;
    const nextYear = m + 1 > 12 ? year + 1 : year;
    return `${nextYear}-${String(nextMonth).padStart(2, "0")}-07`;
  }

  // 📅 Dates for expenses
  const raised_date         = `${month}-01`;               // 1st of that month
  const salary_due_date     = getLastDayOfMonth(month);    // salary due: last day of that month
  const statutory_due_date  = getSeventhOfNextMonth(month);// PF/TDS/PT/Insurance: 7th of next month

  // 🔢 Convert numeric fields safely
  const basicPayVal         = parseFloat(basic_pay || 0) || 0;
  const hraVal              = parseFloat(hra || 0) || 0;
  const convVal             = parseFloat(conveyance_allowance || 0) || 0;
  const medicalVal          = parseFloat(medical_allowance || 0) || 0;
  const ltaVal              = parseFloat(lta || 0) || 0;
  const personalVal         = parseFloat(personal_allowance || 0) || 0;
  const grossVal            = parseFloat(gross_salary || 0) || 0;
  const ctcVal              = parseFloat(ctc || 0) || 0;

  const ptVal               = parseFloat(professional_tax || 0) || 0;
  const pfEmpVal            = parseFloat(pf || 0) || 0;
  const insEmpVal           = parseFloat(insurance || 0) || 0;
  const tdsVal              = parseFloat(tds || 0) || 0;

  const pfEmployerVal       = parseFloat(employer_pf || 0) || 0;
  const insEmployerVal      = parseFloat(employer_health_insurance || 0) || 0;

  const netTakehomeVal      = parseFloat(net_takehome || 0) || 0;

  // ✅ Totals (Employee + Employer)
  const total_pf_monthly        = pfEmpVal + pfEmployerVal;           // e.g. 1800 + 1800 = 3600
  const total_insurance_monthly = insEmpVal + insEmployerVal;         // e.g. 500 + 500 = 1000

  console.log("🧮 Totals -> PF:", total_pf_monthly, "Insurance:", total_insurance_monthly);

  // 🧾 SQL for salary_payments (MUST MATCH TABLE COLUMNS)
  const insertSalaryQuery = `
    INSERT INTO salary_payments (
      employee_id,
      employee_name,
      month,
      paid,
      paid_date,

      basic_pay,
      hra,
      conveyance_allowance,
      medical_allowance,
      lta,
      personal_allowance,
      gross_salary,
      ctc,

      professional_tax,
      insurance,
      pf,
      tds,

      employer_pf,
      employer_health_insurance,
      net_takehome,

      total_pf,
      total_insurance
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  // 🔍 Ensure employee exists (FK safety)
  const checkEmployeeSql = `
    SELECT employee_id, employee_name
    FROM employees
    WHERE employee_id = ?
  `;

  db.get(checkEmployeeSql, [employee_id], (empErr, empRow) => {
    if (empErr) {
      console.error("❌ Error checking employee in /addsalaries:", empErr);
      return res.status(500).json({ error: empErr.message });
    }

    if (!empRow) {
      console.error("❌ Employee not found for employee_id:", employee_id);
      return res.status(400).json({
        error: `Employee with employee_id ${employee_id} not found in employees table`,
      });
    }

    const finalEmpName = employee_name || empRow.employee_name || "";

    // 💾 Insert into salary_payments
    db.run(
      insertSalaryQuery,
      [
        employee_id,
        finalEmpName,
        month,
        paid || "No",
        paid_date || null,

        basicPayVal,
        hraVal,
        convVal,
        medicalVal,
        ltaVal,
        personalVal,
        grossVal,
        ctcVal,

        ptVal,
        insEmpVal,
        pfEmpVal,
        tdsVal,

        pfEmployerVal,
        insEmployerVal,
        netTakehomeVal,

        total_pf_monthly,
        total_insurance_monthly,
      ],
      function (err) {
        if (err) {
          console.error("❌ Salary Insert Error (addsalaries):", err);
          return res.status(500).json({ error: err.message });
        }

        const salary_payment_id = this.lastID;
        console.log("✅ Salary inserted with ID:", salary_payment_id);

        // ==========================
        //  Create related EXPENSES
        // ==========================
        const expensesToInsert = [];

        // 1️⃣ Salary (net take-home)
        if (netTakehomeVal > 0) {
          expensesToInsert.push({
            type: `Salary - ${finalEmpName} (${employee_id})`,
            description: `Salary for ${month}`,
            amount: netTakehomeVal,
            due: salary_due_date,
          });
        }

        // 2️⃣ TDS expense (monthly TDS)
        if (tdsVal > 0) {
          expensesToInsert.push({
            type: `TDS - ${finalEmpName} (${employee_id})`,
            description: `TDS for ${month}`,
            amount: tdsVal,
            due: statutory_due_date,
          });
        }

        // 3️⃣ PF (EMPLOYEE + EMPLOYER → TOTAL PF)
        if (total_pf_monthly > 0) {
          expensesToInsert.push({
            type: `PF - ${finalEmpName} (${employee_id})`,
            description: `PF (Employee + Employer) for ${month}`,
            amount: total_pf_monthly, // ✅ NOW TOTAL PF
            due: statutory_due_date,
          });
        }

        // 4️⃣ INSURANCE (EMPLOYEE + EMPLOYER → TOTAL INSURANCE)
        if (total_insurance_monthly > 0) {
          expensesToInsert.push({
            type: `Insurance - ${finalEmpName} (${employee_id})`,
            description: `Insurance (Employee + Employer) for ${month}`,
            amount: total_insurance_monthly, // ✅ NOW TOTAL INSURANCE
            due: statutory_due_date,
          });
        }

        // 5️⃣ Professional Tax
        if (ptVal > 0) {
          expensesToInsert.push({
            type: `Professional Tax - ${finalEmpName} (${employee_id})`,
            description: `Professional Tax for ${month}`,
            amount: ptVal,
            due: statutory_due_date,
          });
        }

        const insertExpenseQuery = `
          INSERT INTO expenses (
            regular,
            type,
            description,
            amount,
            currency,
            raised_date,
            due_date,
            paid_date,
            paid_amount,
            Active,
            status
          ) VALUES (?, ?, ?, ?, 'INR', ?, ?, NULL, NULL, 'Yes', 'Raised')
        `;

        expensesToInsert.forEach((exp) => {
          db.run(
            insertExpenseQuery,
            [
              "Yes",
              exp.type,
              exp.description,
              exp.amount,
              raised_date,
              exp.due,
            ],
            (err2) => {
              if (err2) {
                console.error("⚠️ Expense Insert Error:", err2);
              }
            }
          );
        });

        return res.json({
          success: true,
          message: "Salary and related expenses created successfully",
          salary_payment_id,
          expenses_created: expensesToInsert.length,
        });
      }
    );
  });
});
app.get("/getAvailableEmployeesForSalaries", (req, res) => {
  const sql = `
    SELECT employee_id, employee_name, ctc, date_of_joining
    FROM employees
    WHERE employee_id NOT IN (
      SELECT employee_id FROM salary_payments WHERE employee_id IS NOT NULL
    )
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});
// Post Forecast
app.post("/forecasts", (req, res) => {
  const { name, start_date, end_date } = req.body;

  if (!name || !start_date || !end_date) {
    return res.status(400).json({ error: "All fields are required" });
  }

  db.run(
    `INSERT INTO forecasts (name, start_date, end_date) VALUES (?, ?, ?)`,
    [name, start_date, end_date],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, forecast_id: this.lastID });
    }
  );
});

// Get Forcasts
app.get("/forecasts", (req, res) => {
  db.all(`SELECT * FROM forecasts`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ forecasts: rows });
  });
});

// Update forcast End Date
app.put("/forecasts/:id", (req, res) => {
  const { id } = req.params;
  const { end_date } = req.body;

  if (!end_date) return res.status(400).json({ error: "End date is required" });

  db.run(
    `UPDATE forecasts SET end_date = ? WHERE id = ?`,
    [end_date, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Forecast not found" });

      res.json({ success: true, message: "End date updated successfully" });
    }
  );
});

// POST /transactions
app.post("/transactions", (req, res) => {
  const { forecast_id, name, type, amount, start_date, end_date, category } = req.body;

  if (!forecast_id || !name || !type || !amount || !start_date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  db.get("SELECT end_date FROM forecasts WHERE id = ?", [forecast_id], (err, forecast) => {
    if (err) {
      console.error("DB Error:", err);
      return res.status(500).json({ error: err.message });
    }

    if (!forecast) {
      console.error("Forecast not found for id:", forecast_id);
      return res.status(404).json({ error: "Forecast not found" });
    }

    const finalEndDate = end_date || forecast.end_date;

    db.run(
      `INSERT INTO forecast_transactions (forecast_id, name, type, amount, start_date, end_date, category)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [forecast_id, name, type, amount, start_date, finalEndDate, category || null],
      function (err) {
        if (err) {
          console.error("Insert Error:", err);
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, transactionId: this.lastID });
      }
    );
  });
});
// Getting Particular Forcast Transactions
app.get("/transactions/:forecastId", (req, res) => {
  const forecastId = req.params.forecastId;

  const query = "SELECT * FROM forecast_transactions WHERE forecast_id = ?";

  db.all(query, [forecastId], (err, rows) => {
    if (err) {
      console.error("Fetch Error:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ transactions: rows });
  });
});
app.post("/invoices", (req, res) => {
  const {
    invoice_number,
    invoice_date,
    client_name,
    project_id,
    start_date,
    end_date,
    invoice_cycle,
    invoice_value,
    gst_amount,
    due_date,
    billable_days,
    non_billable_days,
    received,
    received_date,
  } = req.body;

  // STEP 1: Get Client Payment Terms
  db.get(
    "SELECT paymentTerms FROM ClientsTable WHERE clientName = ?",
    [client_name],
    (err, client) => {
      if (err) return res.status(500).json({ error: "Error fetching client data" });
      if (!client) return res.status(400).json({ error: "Client not found" });

      const paymentTerms = client.paymentTerms || 0;

      // Auto-calc due date
      let finalDueDate = due_date;
      if (!finalDueDate) {
        const d = new Date(invoice_date);
        d.setDate(d.getDate() + paymentTerms + 2);
        finalDueDate = d.toISOString().split("T")[0];
      }

      // STEP 2: Get Project
      db.get(
        "SELECT isFixed, invoiceCycle FROM Projects WHERE projectID = ?",
        [project_id],
        (err, project) => {
          if (err) return res.status(500).json({ error: "Error fetching project" });
          if (!project) return res.status(400).json({ error: "Project not found" });

          // ✅ STEP 3: Decide FINAL invoice cycle (CORRECT PLACE)
          const finalInvoiceCycle =
            project.isFixed === "Yes"
              ? project.invoiceCycle || "Monthly"
              : invoice_cycle || project.invoiceCycle || "Monthly";

          // STEP 4: Insert Invoice
          const sql = `
            INSERT INTO invoices (
              invoice_number,
              invoice_date,
              client_name,
              project_id,
              start_date,
              end_date,
              invoice_cycle,
              invoice_value,
              gst_amount,
              due_date,
              billable_days,
              non_billable_days,
              received,
              received_date
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

          db.run(
            sql,
            [
              invoice_number,
              invoice_date,
              client_name,
              project_id,
              start_date,
              end_date,
              finalInvoiceCycle, // ✅ FIXED
              invoice_value,
              gst_amount,
              finalDueDate,
              billable_days,
              non_billable_days,
              received || "No",
              received_date || null,
            ],
            function (err) {
              if (err) {
                console.error("Insert error:", err);
                return res.status(500).json({ error: err.message });
              }

              res.json({
                success: true,
                invoice_id: this.lastID,
                message: "Invoice saved successfully",
              });
            }
          );
        }
      );
    }
  );
});

app.get("/invoices", (req, res) => {
  const query = "SELECT * FROM invoices ORDER BY invoice_date DESC";

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error("Fetch Invoices Error:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ invoices: rows });
  });
});

// GET client details + all their projects
app.get("/clientsprojects/:clientID", (req, res) => {
  const { clientID } = req.params;

  // Query client details
  const clientQuery = `SELECT * FROM ClientsTable WHERE id = ?`;

  db.get(clientQuery, [clientID], (err, client) => {
    if (err) {
      console.error("Error fetching client:", err.message);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // Query only active projects linked to this client
    const projectQuery = `SELECT * FROM Projects WHERE clientID = ? AND active = 'Yes'`;

    db.all(projectQuery, [clientID], (err, projects) => {
      if (err) {
        console.error("Error fetching projects:", err.message);
        return res.status(500).json({ error: "Internal Server Error" });
      }

      res.json({
        client,
        projects,
      });
    });
  });
});
app.get("/getProject/:id", (req, res) => {
  const { id } = req.params;
  const sql = "SELECT * FROM Projects WHERE projectID = ?";

  db.get(sql, [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ message: "Project not found" });
    }

    // ✅ ADD THIS BLOCK (safe)
    try {
      row.milestones = row.milestones
        ? JSON.parse(row.milestones)
        : [];
    } catch {
      row.milestones = [];
    }

    res.json(row);
  });
});


// // API to fetch active projects
// app.get("/getactive-projects", (req, res) => {
//   const { filterMonthYear } = req.query; // e.g., "2025-09"

//   // Default to current month if not provided
//   const today = new Date();
//   const yearMonth =
//     filterMonthYear ||
//     `${today.getFullYear()}-${(today.getMonth() + 1)
//       .toString()
//       .padStart(2, "0")}`;

//   const sql = `
//     SELECT p.*,
//            c.clientName,
//            i.*,
//            COALESCE(t.total_invoice_amount, 0) AS total_invoice_amount
//     FROM Projects p
//     LEFT JOIN ClientsTable c ON c.id = p.clientID
//     LEFT JOIN (
//       SELECT *
//       FROM invoices
//       WHERE strftime('%Y-%m', invoice_date) = '${yearMonth}'
//     ) i ON i.project_id = p.projectID
//     LEFT JOIN (
//       SELECT project_id, SUM(invoice_value) AS total_invoice_amount
//       FROM invoices
//       GROUP BY project_id
//     ) t ON t.project_id = p.projectID
//     WHERE p.active = 'Yes'
//     ORDER BY p.projectID, i.invoice_date
//   `;

//   db.all(sql, [], (err, rows) => {
//     if (err) {
//       console.error("Error fetching active projects:", err.message);
//       return res.status(500).json({ error: err.message });
//     }

//     // 🔹 Fetch employee master to map IDs → Names
//     db.all(
//       "SELECT employee_id, employee_name FROM employees",
//       [],
//       (err2, emps) => {
//         if (err2) {
//           console.error("Error fetching employees:", err2.message);
//           return res.status(500).json({ error: err2.message });
//         }

//         const map = new Map(emps.map((e) => [e.employee_id, e.employee_name]));

//         const formatted = rows.map((row) => {
//           let parsed = [];
//           try {
//             const arr = JSON.parse(row.employees || "[]");
//             parsed = arr.map((emp) => ({
//               id: typeof emp === "string" ? emp : emp.id,
//               name:
//                 typeof emp === "string"
//                   ? map.get(emp) || emp // fallback to ID if name missing
//                   : emp.name,
//             }));
//           } catch (e) {
//             parsed = [];
//           }

//           return {
//             ...row,
//             employees: parsed, // ✅ now an array, not string
//           };
//         });

//         res.json(formatted);
//       }
//     );
//   });
// });

// API to fetch active projects
app.get("/getactive-projects", (req, res) => {
  const { filterMonthYear } = req.query;

  const today = new Date();
  const yearMonth =
    filterMonthYear ||
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const sql = `
    SELECT p.*,
           c.clientName,
           i.*,
           COALESCE(t.total_invoice_amount, 0) AS total_invoice_amount
    FROM Projects p
    LEFT JOIN ClientsTable c ON c.id = p.clientID
    LEFT JOIN (
      SELECT *
      FROM invoices
      WHERE strftime('%Y-%m', invoice_date) = '${yearMonth}'
    ) i ON i.project_id = p.projectID
    LEFT JOIN (
      SELECT project_id, SUM(invoice_value) AS total_invoice_amount
      FROM invoices
      GROUP BY project_id
    ) t ON t.project_id = p.projectID
    WHERE p.active = 'Yes'
    ORDER BY p.projectID, i.invoice_date
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error("Error fetching active projects:", err.message);
      return res.status(500).json({ error: err.message });
    }

    db.all(
      "SELECT employee_id, employee_name FROM employees",
      [],
      (err2, emps) => {
        if (err2) {
          return res.status(500).json({ error: err2.message });
        }

        const empMap = new Map(emps.map(e => [e.employee_id, e.employee_name]));

        const formatted = rows.map(row => {
          // 🔹 Parse employees
          let employees = [];
          try {
            const arr = JSON.parse(row.employees || "[]");
            employees = arr.map(emp => ({
              id: typeof emp === "string" ? emp : emp.id,
              name:
                typeof emp === "string"
                  ? empMap.get(emp) || emp
                  : emp.name,
            }));
          } catch {
            employees = [];
          }

          // ✅ Parse milestones
          let milestones = [];
          try {
            milestones = row.milestones
              ? JSON.parse(row.milestones)
              : [];
          } catch {
            milestones = [];
          }

          return {
            ...row,
            employees,
            milestones,
          };
        });

        res.json(formatted);
      }
    );
  });
});
// Prpoject without INvoice this Month
app.get("/getprojects-no-invoice-current-month", (req, res) => {
  const sql = `
    SELECT p.*
    FROM Projects p
    LEFT JOIN invoices i 
      ON p.projectID = i.project_id 
      AND strftime('%Y-%m', i.invoice_date) = strftime('%Y-%m', 'now') 
    WHERE p.active = 'Yes' 
      AND i.project_id IS NULL
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error("Error fetching projects without invoices for this month:", err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// DELETE /invoices/:id  -- only removes invoice row (does NOT update Projects)
app.delete("/invoices/:id", (req, res) => {
  const invoiceId = req.params.id;
  if (!invoiceId) {
    return res.status(400).json({ success: false, message: "Missing invoice id" });
  }

  db.serialize(() => {
    // 1) fetch the invoice (so we can return it)
    db.get("SELECT * FROM invoices WHERE id = ?", [invoiceId], (err, invoice) => {
      if (err) {
        console.error("DB error fetching invoice:", err);
        return res.status(500).json({ success: false, error: "Database error fetching invoice", details: err.message });
      }
      if (!invoice) {
        return res.status(404).json({ success: false, message: "Invoice not found" });
      }

      // 2) delete invoice row
      db.run("DELETE FROM invoices WHERE id = ?;", [invoiceId], function (delErr) {
        if (delErr) {
          console.error("Failed to delete invoice:", delErr);
          return res.status(500).json({ success: false, error: "Failed to delete invoice", details: delErr.message });
        }

        // success: return the previously fetched invoice object
        return res.json({
          success: true,
          message: "Invoice deleted.",
          invoice: invoice,
        });
      });
    });
  });
});

// Update Project by ID
app.put("/update-project/:id", upload.single("purchaseOrder"), (req, res) => {
  const { id } = req.params;
  const data = req.body;
  const file = req.file ? req.file.filename : null;

  // ✅ Parse employees
  let employeesData = [];
  try {
    employeesData =
      typeof data.employees === "string"
        ? JSON.parse(data.employees)
        : data.employees;
  } catch (err) {
    console.error("Error parsing employees JSON:", err);
  }

  // ✅ Parse milestones
  let milestonesData = [];
  try {
    milestonesData =
      typeof data.milestones === "string"
        ? JSON.parse(data.milestones)
        : data.milestones;
  } catch (err) {
    console.error("Error parsing milestones JSON:", err);
  }

  // ✅ Base SQL
  let sql = `
    UPDATE Projects
    SET 
      clientID = ?, 
      projectName = ?, 
      projectDescription = ?, 
      startDate = ?, 
      endDate = ?, 
      skill = ?, 
      projectLocation = ?, 
      spoc = ?, 
      mailID = ?, 
      mobileNo = ?, 
      billingType = ?, 
      billRate = ?, 
      monthlyBilling = ?, 
      gst = ?,
      tds = ?,
      netPayable = ?,
      employees = ?,
      hoursOrDays = ?,
      poNumber = ?, 
      purchaseOrderValue = ?, 
      active = ?, 
      invoiceCycle = ?,
      isFixed = ?,            -- ✅ NEW
      startMonth = ?,         -- ✅ NEW
      milestones = ?          -- ✅ NEW
  `;

  // ✅ Add purchaseOrder if uploaded
  if (file) sql += `, purchaseOrder = ?`;

  sql += ` WHERE projectID = ?`;

  // ✅ Params (ORDER MUST MATCH SQL)
  const params = [
    data.clientID,
    data.projectName,
    data.projectDescription,
    data.startDate,
    data.endDate,
    data.skill,
    data.projectLocation,
    data.spoc,
    data.mailID,
    data.mobileNo,
    data.billingType,
    data.billRate,
    data.monthlyBilling,
    data.gst,
    data.tds,
    data.netPayable,
    JSON.stringify(employeesData || []),
    data.hoursOrDays,
    data.poNumber,
    data.purchaseOrderValue,
    data.active,
    data.invoiceCycle,
    data.isFixed,
    data.startMonth || null,
    JSON.stringify(milestonesData || []),
  ];

  if (file) params.push(file);
  params.push(id);

  // ✅ Execute update
  db.run(sql, params, function (err) {
    if (err) {
      console.error("DB Error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }

    res.json({ success: true, changes: this.changes });
  });
});

// Update Client by ID
app.put("/update-client/:id", (req, res) => {
  const clientId = req.params.id;
  const {
    clientName,
    aboutClient,
    paymentTerms,
    location,
    contactSpoc,
    contactEmail,
    contactNumber,
    gstApplicable,
    gstNumber,
    gstPercentage,
  } = req.body;

  const sql = `
    UPDATE ClientsTable
    SET clientName = ?,
        aboutClient = ?,
        paymentTerms = ?,
        location = ?,
        contactSpoc = ?,
        contactEmail = ?,
        contactNumber = ?,
        gstApplicable = ?,
        gstNumber = ?,
        gstPercentage = ?
    WHERE id = ?
  `;

  db.run(
    sql,
    [
      clientName,
      aboutClient,
      paymentTerms,
      location,
      contactSpoc,
      contactEmail,
      contactNumber,
      gstApplicable,
      gstNumber,
      gstPercentage,
      clientId,
    ],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true });
    }
  );
});

// Update Employee by ID
app.put("/employees/:id", upload.fields([
  { name: "resume", maxCount: 1 },
  { name: "photo", maxCount: 1 }
]), (req, res) => {
  const employeeId = req.params.id;

  const {
    employee_id,
    employee_name,
    email,
    phone_number,
    skills,
    salary_paid,
    billable,
    consultant_regular,
    active,
    ctc,
    project_ending,
    date_of_joining,
  } = req.body;

  // Ensure uploaded files are stored with "uploads/" path
  const resume = req.files?.resume ? `uploads/${req.files.resume[0].filename}` : null;
  const photo  = req.files?.photo  ? `uploads/${req.files.photo[0].filename}`  : null;

  const fields = [
    { key: "employee_id", value: employee_id },
    { key: "employee_name", value: employee_name },
    { key: "email", value: email },
    { key: "phone_number", value: phone_number },
    { key: "skills", value: skills },
    { key: "salary_paid", value: salary_paid },
    { key: "billable", value: billable },
    { key: "consultant_regular", value: consultant_regular },
    { key: "active", value: active },
    { key: "project_ending", value: project_ending },
    { key: "ctc", value: ctc },
    { key: "resume", value: resume },
    { key: "photo", value: photo },
    { key: "date_of_joining", value: date_of_joining },
  ].filter(f => f.value !== null && f.value !== undefined);

  const setClause = fields.map(f => `${f.key} = ?`).join(", ");
  const values = fields.map(f => f.value);
  values.push(employeeId); // for WHERE clause

  const sql = `UPDATE employees SET ${setClause} WHERE id = ?`;

  db.run(sql, values, function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, changes: this.changes });
  });
});
// Delete Employee by ID
app.delete("/employees/:id", (req, res) => {
  const { id } = req.params;
  const sql = `DELETE FROM employees WHERE id = ?`;

  db.run(sql, [id], function(err) {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ error: "Failed to delete employee" });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }
    res.json({ message: "Employee deleted successfully" });
  });
});

// Delete Project by ID
app.delete("/deleteproject/:id", (req, res) => {
  const { id } = req.params;

  const query = `DELETE FROM Projects WHERE projectID = ?`;
  db.run(query, [id], function (err) {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ message: "Failed to delete project" });
    }

    if (this.changes === 0) {
      return res.status(404).json({ message: "Project not found" });
    }

    res.json({ message: "Project deleted successfully" });
  });
});

// Delete Client by ID
app.delete("/deleteclient/:id", (req, res) => {
  const { id } = req.params;
  const query = `DELETE FROM ClientsTable WHERE id = ?`;

  db.run(query, [id], function(err) {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ message: "Failed to delete client" });
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: "Client not found" });
    }
    res.json({ message: "Client deleted successfully" });
  });
});

// GET /invoices/month/:month
// month format: YYYY-MM
app.get("/invoices/month/:month", (req, res) => {
  const { month } = req.params; // e.g., "2025-09"

  if (!month.match(/^\d{4}-\d{2}$/)) {
    return res.status(400).json({ error: "Invalid month format. Use YYYY-MM." });
  }

  const sql = `
    SELECT * FROM invoices
    WHERE due_date LIKE ?
    ORDER BY due_date ASC
  `;

  const param = month + "%"; // matches all dates in that month

  db.all(sql, [param], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Update invoice API
app.put("/invoices/:id", (req, res) => {
  const id = req.params.id;
  const inv = req.body;

  const query = `
    UPDATE invoices
    SET
      invoice_number = ?,
      invoice_date = ?,
      client_name = ?,
      project_id = ?,
      start_date = ?,
      end_date = ?,
      invoice_cycle = ?,
      invoice_value = ?,
      gst_amount = ?,
      due_date = ?,
      billable_days = ?,
      received = ?,
      received_date = ?
    WHERE id = ?
  `;

  db.run(
    query,
    [
      inv.invoice_number,
      inv.invoice_date || "",
      inv.client_name,
      inv.project_id,
      inv.start_date,
      inv.end_date,
      inv.invoice_cycle,
      inv.invoice_value,
      inv.gst_amount,
      inv.due_date,
      inv.billable_days,
      inv.received,
      inv.received_date || null,
      id,
    ],
    function (err) {
      if (err) return res.status(500).json({ message: err.message });
      // Return updated invoice
      db.get("SELECT * FROM invoices WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json(row);
      });
    }
  );
});

// Update Received Status and Received Date
app.put("/updateinvoices/:id", (req, res) => {
  const { id } = req.params;
  const { received, received_date } = req.body;

  // ✅ 1. Validate input
  if (!["Yes", "No"].includes(received)) {
    return res.status(400).json({ error: "Received must be 'Yes' or 'No'" });
  }

  // ✅ 2. Handle received date
  const updatedDate = received === "Yes" ? received_date || null : null;

  const updateInvoiceQuery = `
    UPDATE invoices
    SET received = ?, received_date = ?
    WHERE id = ?
  `;

  // ✅ 3. Update invoice
  db.run(updateInvoiceQuery, [received, updatedDate, id], function (err) {
    if (err) {
      console.error("❌ Error updating invoice:", err);
      return res.status(500).json({ error: "Failed to update invoice" });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    console.log(`✅ Invoice ${id} updated with received=${received}, date=${updatedDate}`);

    // ✅ 4. Fetch updated invoice
    db.get("SELECT * FROM invoices WHERE id = ?", [id], (err, invoice) => {
      if (err) {
        console.error("❌ Error fetching updated invoice:", err);
        return res.status(500).json({ error: "Failed to fetch updated invoice" });
      }

      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found after update" });
      }

      // ✅ 5. Fetch Current Account
      db.get(
        "SELECT account_number, balance FROM accounts WHERE account_type = 'Current' LIMIT 1",
        (err, account) => {
          if (err) {
            console.error("❌ Error fetching current account:", err);
            return res.status(500).json({ error: "Failed to fetch current account" });
          }

          if (!account) {
            return res.status(400).json({ error: "No current account found" });
          }

          // ✅ 6. Calculate Amount (Invoice Value - GST)
          const invoiceNumber = invoice.invoice_number;
          const amount =
            (Number(invoice.invoice_value) || 0) -
            (Number(invoice.gst_amount) || 0);
          const accountNumber = account.account_number;
          const previousBalance = Number(account.balance) || 0;
          let updatedBalance, type, description, transactionId;

          // ✅ 7. Generate Timestamp for Transaction ID (ddMMyyHH)
          const now = new Date();
          const timestamp = `${String(now.getDate()).padStart(2, "0")}${String(
            now.getMonth() + 1
          ).padStart(2, "0")}${String(now.getFullYear()).slice(-2)}${String(
            now.getHours()
          ).padStart(2, "0")}`;

          if (received === "Yes") {
            transactionId = `T${invoiceNumber}|${timestamp}`;
            type = "Credit";
            description = `Payment received for invoice ${invoiceNumber}`;
            updatedBalance = previousBalance + amount;
          } else {
            transactionId = `T${invoiceNumber}|${timestamp}`;
            type = "Debit";
            description = `Payment reversed for invoice ${invoiceNumber}`;
            updatedBalance = previousBalance - amount;
          }

          // ✅ 8. Insert Transaction Record
          const insertTransactionQuery = `
            INSERT INTO transactions 
              (transaction_id, account_number, type, description, amount, previous_balance, updated_balance)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `;

          db.run(
            insertTransactionQuery,
            [
              transactionId,
              accountNumber,
              type,
              description,
              amount,
              previousBalance,
              updatedBalance,
            ],
            function (err) {
              if (err) {
                if (err.message.includes("UNIQUE constraint failed")) {
                  console.warn(`⚠️ Transaction already exists for ${transactionId}`);
                } else {
                  console.error("❌ Error inserting transaction:", err);
                  return res.status(500).json({ error: "Failed to insert transaction" });
                }
              } else {
                console.log(`✅ Transaction recorded: ${transactionId}`);
              }

              // ✅ 9. Update Account Balance
              db.run(
                "UPDATE accounts SET balance = ? WHERE account_number = ?",
                [updatedBalance, accountNumber],
                (err) => {
                  if (err) {
                    console.error("❌ Error updating account balance:", err);
                    return res.status(500).json({ error: "Failed to update account balance" });
                  }

                  console.log(
                    `💰 Account ${accountNumber} updated: Old=${previousBalance}, New=${updatedBalance}`
                  );

                  // ✅ 10. Send Response
                  res.json({
                    message:
                      received === "Yes"
                        ? "Invoice marked as received, credited to account successfully."
                        : "Invoice marked as not received, amount reversed successfully.",
                    invoice,
                    transaction: {
                      transaction_id: transactionId,
                      type,
                      amount,
                      description,
                      account_number: accountNumber,
                      previous_balance: previousBalance,
                      updated_balance: updatedBalance,
                    },
                    updated_balance: updatedBalance,
                  });
                }
              );
            }
          );
        }
      );
    });
  });
});

/* =========================
   Helpers
   ========================= */

// Safe read for total_insurance
function getEmployeeInsurance(employeeId, cb) {
  db.get(
    `SELECT total_insurance AS insurance_val FROM salary_payments WHERE employee_id = ? LIMIT 1`,
    [employeeId],
    (err, row) => {
      if (err) {
        console.error("getEmployeeInsurance error:", err);
        return cb(err);
      }
      const val = row ? parseFloat(row.insurance_val) || 0 : 0;
      return cb(null, val);
    }
  );
}

// Credit insurance into KITTY account (runs its own small transaction)
function creditInsuranceToKitty(employeeId, paidDate, cb = () => {}) {
  console.log(`🔄 creditInsuranceToKitty: ${employeeId} ${paidDate}`);
  getEmployeeInsurance(employeeId, (err, insuranceAmount) => {
    if (err) return cb(err);
    if (!insuranceAmount || insuranceAmount <= 0) {
      console.log("ℹ️ No insurance to credit for", employeeId);
      return cb(null, { credited: false, reason: "zero_insurance" });
    }

    db.get(`SELECT * FROM accounts WHERE account_name LIKE '%KITTY%' LIMIT 1`, [], (kErr, kittyAcc) => {
      if (kErr) return cb(kErr);
      if (!kittyAcc) return cb(new Error("KITTY account not found"));

      const prevBal = parseFloat(kittyAcc.balance) || 0;
      const newBal = prevBal + insuranceAmount;

      db.serialize(() => {
        db.run("BEGIN TRANSACTION", (bErr) => {
          if (bErr) return cb(bErr);
          db.run(`UPDATE accounts SET balance = ? WHERE account_id = ?`, [newBal, kittyAcc.account_id], function (updErr) {
            if (updErr) {
              console.error("❌ Failed to update KITTY:", updErr);
              return db.run("ROLLBACK", () => cb(updErr));
            }

            const now = new Date();
            const hhmm = `${now.getHours().toString().padStart(2, "0")}${now.getMinutes().toString().padStart(2, "0")}`;
            const txId = `CRD|KITTY|INS|${paidDate || now.toISOString().slice(0, 10)}|${hhmm}`;
            const description = `Insurance credit for employee ${employeeId}`;

            db.run(
              `INSERT INTO transactions (transaction_id, account_number, type, amount, description, previous_balance, updated_balance, created_at)
               VALUES (?, ?, 'Credit', ?, ?, ?, ?, datetime('now'))`,
              [txId, kittyAcc.account_number, insuranceAmount, description, prevBal, newBal],
              function (insErr) {
                if (insErr) {
                  console.error("❌ Failed to insert KITTY tx:", insErr);
                  return db.run("ROLLBACK", () => cb(insErr));
                }
                db.run("COMMIT", (cErr) => {
                  if (cErr) return db.run("ROLLBACK", () => cb(cErr));
                  console.log(`✅ Credited ₹${insuranceAmount} to KITTY ${kittyAcc.account_number}`);
                  return cb(null, { credited: true, transaction_id: txId, previous_balance: prevBal, updated_balance: newBal });
                });
              }
            );
          });
        });
      });
    });
  });
}

/* =========================
   Existing helpers preserved
   ========================= */

function updateExpensePaymentOnSalaryPaid(employeeId, month_year, paidAmount, paidDate) {
  console.log("🔄 Updating expense_payments for salary payment...");

  const empQuery = `SELECT employee_name FROM salary_payments WHERE employee_id = ?`;
  db.get(empQuery, [employeeId], (err, emp) => {
    if (err || !emp) return console.error("❌ Employee not found in salary_payments.");

    const typeString = `Salary - ${emp.employee_name} (${employeeId})`;
    const expQuery = `SELECT auto_id FROM expenses WHERE type = ? LIMIT 1`;
    db.get(expQuery, [typeString], (err2, expense) => {
      if (err2 || !expense) return console.error("❌ No expense entry found for:", typeString);
      const expenseId = expense.auto_id;
      const updateExpensePayment = `
        UPDATE expense_payments
        SET paid_amount = ?, paid_date = ?, status = 'Paid'
        WHERE expense_id = ? AND month_year = ?
      `;
      db.run(updateExpensePayment, [paidAmount, paidDate, expenseId, month_year], function (err3) {
        if (err3) return console.error("❌ Error updating expense_payments:", err3);
        if (this.changes === 0) console.log("⚠️ No existing expense_payments found. Ignoring.");
        else console.log("✅ expense_payments updated successfully.");
      });
    });
  });
}

function updateSalaryOnExpensePaid(expense, expenseType, month_year, paidAmount, paidDate) {
  console.log("🔄 Salary update triggered from expense...");

  if (!/salary/i.test(expenseType)) {
    console.log("⏭ Not a salary expense. Skipping monthly_salary_payments upsert.");
    return;
  }

  let employeeId = null;
  if (expense && (expense.employee_id || expense.emp_id || expense.employeeId)) {
    employeeId = (expense.employee_id || expense.emp_id || expense.employeeId).toString().trim();
  } else {
    const cleaned = expenseType.replace(/salary\s*[-:]?\s*/i, "").trim();
    const idMatch = cleaned.match(/\(([^)]+)\)/);
    if (idMatch) employeeId = idMatch[1].trim();
  }

  if (!employeeId) {
    console.log("❌ Could not determine employee ID. Aborting salary upsert.");
    return;
  }

  const employeeName = (expense && expense.employee_name) || (expense && (expense.employee || expense.name)) || expenseType.replace(/\([^)]*\)/g, "").replace(/salary\s*[-:]?\s*/i, "").trim();
  const targetMonth = month_year.slice(0, 7);

  const updateQuery = `
    UPDATE monthly_salary_payments
    SET paid = 'Yes', paid_amount = ?, actual_to_pay = ?, paid_date = ?
    WHERE employee_id = ? AND substr(month,1,7) = ?
  `;

  db.run(updateQuery, [paidAmount, paidAmount, paidDate, employeeId, targetMonth], function (err) {
    if (err) {
      console.error("❌ Error running monthly salary UPDATE:", err);
      return;
    }
    if (this.changes && this.changes > 0) {
      console.log(`✅ Updated monthly_salary_payments for ${employeeId} (${targetMonth})`);
      return;
    }

    const insertQuery = `
      INSERT INTO monthly_salary_payments (employee_id, employee_name, month, paid, paid_amount, actual_to_pay, paid_date)
      VALUES (?, ?, ?, 'Yes', ?, ?, ?)
    `;
    db.run(insertQuery, [employeeId, employeeName || "", targetMonth, paidAmount, paidAmount, paidDate], function (insertErr) {
      if (insertErr) {
        console.error("⚠️ Insert into monthly_salary_payments failed:", insertErr);
        db.run(updateQuery, [paidAmount, paidAmount, paidDate, employeeId, targetMonth], function (finalErr) {
          if (finalErr) console.error("❌ Final attempt also failed:", finalErr);
          else if (this.changes && this.changes > 0) console.log("✅ Final update attempt succeeded after insert conflict.");
        });
        return;
      }
      console.log(`✅ Inserted monthly_salary_payments for ${employeeId} (${targetMonth})`);
    });
  });
}

app.put("/monthlySalary/update/:employeeId/:month", (req, res) => {
  const { employeeId, month } = req.params;
  const { paid, lop, paidAmount, actualToPay } = req.body;

  if (!paid || !month) {
    return res
      .status(400)
      .json({ success: false, message: "Paid status and month are required" });
  }

  const paidDate = paid === "Yes" ? new Date().toISOString().slice(0, 10) : null;
  const lopVal = Number(lop || 0);
  const paidAmtVal = Number(paidAmount || 0);
  const actualToPayVal = Number(actualToPay || paidAmtVal || 0);

  if (paid === "Yes" && (Number.isNaN(paidAmtVal) || paidAmtVal < 0)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid paidAmount" });
  }

  // 🔹 Helper: get employee_name for insert
  const getEmployeeName = (callback) => {
    db.get(
      `SELECT employee_name FROM salary_payments WHERE employee_id = ? LIMIT 1`,
      [employeeId],
      (err, row) => {
        if (err) return callback(err);
        if (!row) return callback(new Error("Employee not found"));
        callback(null, row.employee_name);
      }
    );
  };

  // ----------------------------------------------------------------------
  //  C R E D I T  K I T T Y  +  E X P E N S E  (unchanged from your logic)
  // ----------------------------------------------------------------------
  const continueToKittyCredit = () => {
    db.get(
      `SELECT employee_name, total_insurance FROM salary_payments WHERE employee_id = ? LIMIT 1`,
      [employeeId],
      (empErr, empRow) => {
        if (empErr || !empRow) {
          return db.run("ROLLBACK", () =>
            res.status(500).json({ success: false, message: "Employee data missing" })
          );
        }

        const employeeName = empRow.employee_name;
        const insuranceAmount = parseFloat(empRow.total_insurance) || 0;
        const typeString = `Salary - ${employeeName} (${employeeId})`;

        db.get(
          `SELECT auto_id, amount FROM expenses WHERE type = ? LIMIT 1`,
          [typeString],
          (expErr, expenseRow) => {
            if (expErr) {
              return db.run("ROLLBACK", () =>
                res.status(500).json({ success: false, message: "Expense lookup failed" })
              );
            }

            const upsertExpensePayment = (next) => {
              if (!expenseRow) return next();

              const expenseId = expenseRow.auto_id;

              db.run(
                `
                UPDATE expense_payments
                SET paid_amount = ?, paid_date = ?, status = 'Paid'
                WHERE expense_id = ? AND month_year = ?
                `,
                [paidAmtVal, paidDate, expenseId, month],
                function (updErr) {
                  if (updErr) {
                    return db.run("ROLLBACK", () =>
                      res.status(500).json({ success: false, message: "expense_payments update failed" })
                    );
                  }

                  if (this.changes > 0) return next();

                  db.run(
                    `
                    INSERT INTO expense_payments
                      (expense_id, month_year, actual_amount, paid_amount, paid_date, status)
                    VALUES (?, ?, ?, ?, ?, 'Paid')
                    `,
                    [
                      expenseId,
                      month,
                      expenseRow.amount || paidAmtVal,
                      paidAmtVal,
                      paidDate,
                    ],
                    function (insErr) {
                      if (insErr) {
                        return db.run("ROLLBACK", () =>
                          res.status(500).json({
                            success: false,
                            message: "expense_payments insert failed",
                          })
                        );
                      }
                      next();
                    }
                  );
                }
              );
            };

            const finalize = (kittyDetails) => {
              db.run("COMMIT", (commitErr) => {
                if (commitErr) {
                  return db.run("ROLLBACK", () =>
                    res.status(500).json({ success: false, message: "Commit failed" })
                  );
                }

                res.json({
                  success: true,
                  message: "Salary paid successfully",
                  kitty: kittyDetails || null,
                });
              });
            };

            upsertExpensePayment(() => {
              if (insuranceAmount <= 0) return finalize(null);

              db.get(
                `SELECT * FROM accounts WHERE account_name LIKE '%KITTY%' LIMIT 1`,
                [],
                (kErr, kittyAcc) => {
                  if (kErr || !kittyAcc) {
                    return db.run("ROLLBACK", () =>
                      res.status(500).json({ success: false, message: "KITTY account missing" })
                    );
                  }

                  const prevBal = parseFloat(kittyAcc.balance);
                  const newBal = prevBal + insuranceAmount;

                  db.run(
                    `UPDATE accounts SET balance = ? WHERE account_id = ?`,
                    [newBal, kittyAcc.account_id],
                    function (updErr) {
                      if (updErr) {
                        return db.run("ROLLBACK", () =>
                          res.status(500).json({ success: false, message: "KITTY update failed" })
                        );
                      }

                      const txId = `KITTY|CR|${Date.now()}`;
                      const desc = `Insurance credit for ${employeeId}`;

                      db.run(
                        `
                        INSERT INTO transactions 
                          (transaction_id, account_number, type, amount, description, previous_balance, updated_balance, created_at)
                        VALUES (?, ?, 'Credit', ?, ?, ?, ?, datetime('now'))
                        `,
                        [
                          txId,
                          kittyAcc.account_number,
                          insuranceAmount,
                          desc,
                          prevBal,
                          newBal,
                        ],
                        function (txErr) {
                          if (txErr) {
                            return db.run("ROLLBACK", () =>
                              res.status(500).json({
                                success: false,
                                message: "KITTY transaction failed",
                              })
                            );
                          }

                          finalize({
                            credited: true,
                            transaction_id: txId,
                            previous_balance: prevBal,
                            updated_balance: newBal,
                          });
                        }
                      );
                    }
                  );
                }
              );
            });
          }
        );
      }
    );
  };

  // ----------------------------------------------------------------------
  //  SALARY PAYMENT FLOW  (UPDATE → INSERT → DEBIT CURRENT → KITTY)
  // ----------------------------------------------------------------------
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    const updateSql = `
      UPDATE monthly_salary_payments
      SET paid = ?, lop = ?, paid_amount = ?, actual_to_pay = ?, paid_date = ?
      WHERE employee_id = ? AND month = ?
    `;

    db.run(
      updateSql,
      [paid, lopVal, paidAmtVal, actualToPayVal, paidDate, employeeId, month],
      function (updErr) {
        if (updErr) {
          return db.run("ROLLBACK", () =>
            res.status(500).json({ success: false, message: "Update failed" })
          );
        }

        // If no rows updated → INSERT
        if (this.changes === 0) {
          getEmployeeName((err, employeeName) => {
            if (err) {
              return db.run("ROLLBACK", () =>
                res.status(500).json({ success: false, message: "Employee fetch failed" })
              );
            }

            db.run(
              `
              INSERT INTO monthly_salary_payments
                (employee_id, employee_name, paid, month, lop, paid_amount, actual_to_pay, paid_date, due_date)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
              [
                employeeId,
                employeeName,
                paid,
                month,
                lopVal,
                paidAmtVal,
                actualToPayVal,
                paidDate,
                null,
              ],
              function (insErr) {
                if (insErr) {
                  return db.run("ROLLBACK", () =>
                    res.status(500).json({ success: false, message: "Insert failed" })
                  );
                }

                if (paid !== "Yes") {
                  return db.run("COMMIT", () =>
                    res.json({ success: true, message: "Salary created (not paid)" })
                  );
                }

                debitCurrentAccount(employeeName);
              }
            );
          });

          return;
        }

        // If update succeeded but not paid
        if (paid !== "Yes") {
          return db.run("COMMIT", () =>
            res.json({ success: true, message: "Salary updated (not paid)" })
          );
        }

        // Continue to debit
        getEmployeeName((_, employeeName) => debitCurrentAccount(employeeName));
      }
    );

    // ==========================================================
    // 🔥 UPDATED FUNCTION — DEBIT SALARY FROM CURRENT ACCOUNT
    // ==========================================================
    function debitCurrentAccount(employeeName) {
      db.get(
        `SELECT * FROM accounts WHERE account_type = 'Current' LIMIT 1`,
        [],
        (err, currentAcc) => {
          if (err || !currentAcc) {
            return db.run("ROLLBACK", () =>
              res.status(500).json({
                success: false,
                message: "Current account not found",
              })
            );
          }

          const prevBal = parseFloat(currentAcc.balance);
          const newBal = prevBal - paidAmtVal;

          if (newBal < 0) {
            return db.run("ROLLBACK", () =>
              res.status(400).json({
                success: false,
                message: "Insufficient CURRENT account balance",
              })
            );
          }

          // Update CURRENT balance
          db.run(
            `UPDATE accounts SET balance = ? WHERE account_id = ?`,
            [newBal, currentAcc.account_id],
            function (updErr) {
              if (updErr) {
                return db.run("ROLLBACK", () =>
                  res.status(500).json({
                    success: false,
                    message: "Failed to update CURRENT balance",
                  })
                );
              }

              // ==========================================
              // ⭐ NEW DEBIT TX FORMAT IMPLEMENTED HERE
              // ==========================================
              const now = new Date();
              const hh = now.getHours().toString().padStart(2, "0");
              const mm = now.getMinutes().toString().padStart(2, "0");
              const hhmm = `${hh}${mm}`;

              const debitTypeString = `Salary - ${employeeName} (${employeeId})`;

              const txId = `DEB|Regular|${debitTypeString}|${month}|${hhmm}`;
              const desc = `Salary debit for ${employeeName} (${employeeId})`;

              db.run(
                `
                INSERT INTO transactions 
                (transaction_id, account_number, type, amount, description, previous_balance, updated_balance, created_at)
                VALUES (?, ?, 'Debit', ?, ?, ?, ?, datetime('now'))
                `,
                [
                  txId,
                  currentAcc.account_number,
                  paidAmtVal,
                  desc,
                  prevBal,
                  newBal,
                ],
                function (txErr) {
                  if (txErr) {
                    return db.run("ROLLBACK", () =>
                      res.status(500).json({
                        success: false,
                        message: "Failed to record debit transaction",
                      })
                    );
                  }

                  continueToKittyCredit();
                }
              );
            }
          );
        }
      );
    }
  });
});



/* =========================
   PUT /pay-expense
   (atomic: debit current, insert transaction, upsert expense_payments, credit KITTY for salary expenses)
   ========================= */
app.put("/pay-expense", (req, res) => {
  const { expense_id, paid_amount, paid_date } = req.body;

  if (!expense_id || !paid_amount || !paid_date) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  const amount = Number(paid_amount);
  if (Number.isNaN(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: "Invalid paid_amount" });
  }

  const paidMonthYear = paid_date.slice(0, 7);
  const now = new Date();
  const timeCode = `${now.getHours().toString().padStart(2, "0")}${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;

  db.get(`SELECT * FROM expenses WHERE auto_id = ? LIMIT 1`, [expense_id], (err, expense) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });

    const expenseType = expense.type || expense.description || "General";
    const isRegular = expense.regular === "Yes" ? "Regular" : "NonReg";
    const transactionId = `DEB|${isRegular}|${expenseType}|${paidMonthYear}|${timeCode}`;
    const description = `Expense paid for ${expenseType} of month ${paidMonthYear}`;

    db.get(`SELECT * FROM accounts WHERE account_type = 'Current' LIMIT 1`, (accErr, currentAcc) => {
      if (accErr) return res.status(500).json({ success: false, message: accErr.message });
      if (!currentAcc) return res.status(500).json({ success: false, message: "Current account not found" });

      const prevBalance = parseFloat(currentAcc.balance) || 0;
      if (prevBalance < amount) {
        return res.status(400).json({ success: false, message: `Insufficient funds. Current balance: ₹${prevBalance} — required: ₹${amount}` });
      }
      const newBalance = prevBalance - amount;

      db.serialize(() => {
        db.run("BEGIN TRANSACTION", (beginErr) => {
          if (beginErr) {
            console.error("BEGIN TRANSACTION error:", beginErr);
            return res.status(500).json({ success: false, message: "Transaction start failed" });
          }

          // update current balance
          db.run(`UPDATE accounts SET balance = ? WHERE account_id = ?`, [newBalance, currentAcc.account_id], function (updErr) {
            if (updErr) {
              console.error("Error updating accounts:", updErr);
              return db.run("ROLLBACK", () => res.status(500).json({ success: false, message: "Failed to update account" }));
            }

            // insert debit transaction
            db.run(
              `INSERT INTO transactions (transaction_id, account_number, type, amount, description, previous_balance, updated_balance, created_at)
               VALUES (?, ?, 'Debit', ?, ?, ?, ?, datetime('now'))`,
              [transactionId, currentAcc.account_number, amount, description, prevBalance, newBalance],
              function (insTxErr) {
                if (insTxErr) {
                  console.error("Error inserting transaction:", insTxErr);
                  return db.run("ROLLBACK", () => res.status(500).json({ success: false, message: "Failed to insert transaction" }));
                }

                // upsert expense_payments
                db.run(
                  `INSERT INTO expense_payments (expense_id, month_year, actual_amount, paid_amount, paid_date, status)
                   VALUES (?, ?, ?, ?, ?, 'Paid')
                   ON CONFLICT(expense_id, month_year) DO UPDATE SET
                     paid_amount = excluded.paid_amount,
                     paid_date = excluded.paid_date,
                     status = 'Paid'`,
                  [expense_id, paidMonthYear, expense.amount || amount, amount, paid_date],
                  function (upsertErr) {
                    if (upsertErr) {
                      console.error("Error upserting expense_payments:", upsertErr);
                      return db.run("ROLLBACK", () => res.status(500).json({ success: false, message: "Failed to record payment" }));
                    }

                    // helper to parse employee id
                    function parseEmployeeIdFromExpense(expenseRow, expenseTypeStr) {
                      if (!expenseRow) return null;
                      if (expenseRow.employee_id || expenseRow.emp_id || expenseRow.employeeId) {
                        return (expenseRow.employee_id || expenseRow.emp_id || expenseRow.employeeId).toString().trim();
                      }
                      const cleaned = (expenseTypeStr || "").replace(/salary\s*[-:]?\s*/i, "").trim();
                      const idMatch = cleaned.match(/\(([^)]+)\)/);
                      return idMatch ? idMatch[1].trim() : null;
                    }

                    const employeeIdFromExpense = parseEmployeeIdFromExpense(expense, expenseType);

                    // commit helper
                    function commitAndRespond(optionalExtras = {}) {
                      db.run("COMMIT", (commitErr) => {
                        if (commitErr) {
                          console.error("COMMIT error:", commitErr);
                          return db.run("ROLLBACK", () => res.status(500).json({ success: false, message: "Failed to commit transaction" }));
                        }

                        // After commit: keep old behavior
                        try {
                          updateSalaryOnExpensePaid(expense, expenseType, paidMonthYear, amount, paid_date);
                        } catch (e) {
                          console.error("post-commit hook failed:", e);
                        }

                        return res.json({
                          success: true,
                          message: `Expense paid successfully.`,
                          transaction_id: transactionId,
                          previous_balance: prevBalance,
                          updated_balance: newBalance,
                          ...optionalExtras,
                        });
                      });
                    }

                    // If salary expense and employeeId found -> credit KITTY inside the same transaction
                    if (/salary/i.test(expenseType) && employeeIdFromExpense) {
                      // fetch insurance (safe helper)
                      getEmployeeInsurance(employeeIdFromExpense, (gErr, insuranceAmount) => {
                        if (gErr) {
                          console.error("❌ failed to fetch employee insurance:", gErr);
                          return db.run("ROLLBACK", () => res.status(500).json({ success: false, message: "Failed to fetch employee insurance" }));
                        }

                        if (!insuranceAmount || insuranceAmount <= 0) {
                          return commitAndRespond();
                        }

                        // find KITTY account
                        db.get(`SELECT * FROM accounts WHERE account_name LIKE '%KITTY%' LIMIT 1`, [], (kErr, kittyAcc) => {
                          if (kErr) {
                            console.error("❌ Error finding KITTY account:", kErr);
                            return db.run("ROLLBACK", () => res.status(500).json({ success: false, message: "Failed to find KITTY account" }));
                          }
                          if (!kittyAcc) {
                            console.error("❌ No KITTY account found");
                            return db.run("ROLLBACK", () => res.status(500).json({ success: false, message: "KITTY account not found" }));
                          }

                          const prevKitty = parseFloat(kittyAcc.balance) || 0;
                          const updatedKitty = prevKitty + insuranceAmount;

                          db.run(`UPDATE accounts SET balance = ? WHERE account_id = ?`, [updatedKitty, kittyAcc.account_id], function (updKittyErr) {
                            if (updKittyErr) {
                              console.error("❌ Error updating KITTY balance:", updKittyErr);
                              return db.run("ROLLBACK", () => res.status(500).json({ success: false, message: "Failed to update KITTY balance" }));
                            }

                            const now2 = new Date();
                            const hhmm2 = `${now2.getHours().toString().padStart(2, "0")}${now2
                              .getMinutes()
                              .toString()
                              .padStart(2, "0")}`;
                            const kittyTxId = `CRD|KITTY|INS|${paidMonthYear}|${hhmm2}`;
                            const desc2 = `Insurance credit for employee ${employeeIdFromExpense}`;

                            db.run(
                              `INSERT INTO transactions (transaction_id, account_number, type, amount, description, previous_balance, updated_balance, created_at)
                               VALUES (?, ?, 'Credit', ?, ?, ?, ?, datetime('now'))`,
                              [kittyTxId, kittyAcc.account_number, insuranceAmount, desc2, prevKitty, updatedKitty],
                              function (kitTxErr) {
                                if (kitTxErr) {
                                  console.error("❌ Error inserting KITTY transaction:", kitTxErr);
                                  return db.run("ROLLBACK", () => res.status(500).json({ success: false, message: "Failed to record KITTY transaction" }));
                                }

                                // success -> commit and respond with KITTY details
                                return commitAndRespond({
                                  kitty_credit: {
                                    transaction_id: kittyTxId,
                                    previous_balance: prevKitty,
                                    updated_balance: updatedKitty,
                                  },
                                });
                              }
                            );
                          });
                        });
                      });
                    } else {
                      // not salary or no employee id -> commit normally
                      commitAndRespond();
                    }
                  } // upsert callback
                ); // db.run upsert
              } // insert transaction callback
            ); // db.run insert transaction
          } // update accounts callback
        ); // db.run update accounts
      }); // BEGIN
    }); // serialize
  }); // get expense
});
});


app.get("/monthlySalary", (req, res) => {
  const query = `
    SELECT * FROM monthly_salary_payments
    ORDER BY month DESC, employee_name
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error("DB Error:", err);
      return res.status(500).json({ success: false, message: "Database error" });
    }

    if (!rows || rows.length === 0) {
      return res.json({ success: true, data: [], message: "No records found" });
    }

    return res.json({ success: true, data: rows });
  });
});

app.get("/getexpenses", (req, res) => {
  try {
    let { month } = req.query;
    if (!month) {
      return res.status(400).json({ error: "Month is required (YYYY-MM)" });
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(month)) month = month.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "Month must be YYYY-MM" });
    }

    const sql = `
WITH params(m) AS (SELECT ? AS m),

expenses_norm AS (
  SELECT 
    e.*,
    CAST(strftime('%d', e.due_date) AS INTEGER) AS due_day,
    CASE 
      WHEN e.regular = 'Yes' THEN substr(e.raised_date,1,7)
      ELSE COALESCE(NULLIF(substr(e.due_date,1,7), ''), substr(e.raised_date,1,7))
    END AS orig_ym
  FROM expenses e
  WHERE e.type IS NOT NULL
    AND e.type NOT LIKE 'Insurance%'
),

months_gen AS (
  SELECT 
    en.auto_id,
    en.regular,
    en.type,
    en.description,
    en.amount,
    en.currency,
    en.orig_ym AS month_year,
    en.orig_ym,
    en.raised_date,
    en.due_date AS expense_due_date,
    en.due_day,
    en.status AS expense_status,
    en.paid_date AS expense_paid_date,
    en.paid_amount AS expense_paid_amount
  FROM expenses_norm en
  WHERE en.regular = 'Yes'
    AND en.orig_ym <= (SELECT m FROM params)

  UNION ALL

  SELECT 
    mg.auto_id,
    mg.regular,
    mg.type,
    mg.description,
    mg.amount,
    mg.currency,
    CASE
      WHEN substr(mg.month_year,6,2) = '12'
        THEN printf('%04d-01', CAST(substr(mg.month_year,1,4) AS INTEGER) + 1)
      ELSE printf('%04d-%02d',
        CAST(substr(mg.month_year,1,4) AS INTEGER),
        CAST(substr(mg.month_year,6,2) AS INTEGER) + 1)
    END,
    mg.orig_ym,
    mg.raised_date,
    mg.expense_due_date,
    mg.due_day,
    mg.expense_status,
    mg.expense_paid_date,
    mg.expense_paid_amount
  FROM months_gen mg
  WHERE mg.month_year < (SELECT m FROM params)
),

single_months AS (
  SELECT 
    en.auto_id,
    en.regular,
    en.type,
    en.description,
    en.amount,
    en.currency,
    en.orig_ym AS month_year,
    en.orig_ym,
    en.raised_date,
    en.due_date AS expense_due_date,
    en.due_day,
    en.status AS expense_status,
    en.paid_date AS expense_paid_date,
    en.paid_amount AS expense_paid_amount
  FROM expenses_norm en
  WHERE en.regular <> 'Yes'
),

all_months AS (
  SELECT * FROM months_gen
  UNION ALL
  SELECT * FROM single_months
)

SELECT 
  am.auto_id,
  am.regular,
  am.type,
  am.description,
  am.amount,
  am.currency,
  am.month_year,
  am.raised_date,

  cl.clientName  AS client_name,
  pr.projectName AS project_name,
  inv.invoice_value,

  ep.actual_amount,
  COALESCE(ep.paid_amount, am.expense_paid_amount) AS paid_amount,
  COALESCE(ep.paid_date, am.expense_paid_date) AS paid_date,
  COALESCE(ep.status, am.expense_status) AS payment_status,

  CASE
    WHEN am.type LIKE 'PF%' 
      OR am.type LIKE 'PT%' 
      OR am.type LIKE 'ESI%' 
      THEN date(am.month_year || '-01', '+1 month', '+6 day')

    WHEN am.type LIKE 'Consultant%' 
      OR am.type LIKE 'TDS%'
      THEN date(am.month_year || '-01', '+1 month', '+9 day')

    WHEN am.type LIKE 'Salary%'
      THEN date(am.month_year || '-01', '+1 month', '-1 day')

    WHEN am.regular = 'Yes'
      THEN (
        CASE
          WHEN am.due_day <= CAST(strftime('%d',
            date(am.month_year || '-01', '+1 month', '-1 day')) AS INTEGER)
          THEN date(am.month_year || '-01', '+' || (am.due_day - 1) || ' day')
          ELSE date(am.month_year || '-01', '+1 month', '-1 day')
        END
      )

    ELSE am.expense_due_date
  END AS computed_due_date

FROM all_months am

LEFT JOIN expense_payments ep
  ON ep.expense_id = am.auto_id
 AND substr(ep.month_year,1,7) = am.month_year

-- ✅ SINGLE INVOICE PER GST (NO DUPLICATES)
LEFT JOIN invoices inv
  ON inv.id = (
    SELECT i.id
    FROM invoices i
    WHERE am.type = 'GST'
      AND am.description LIKE '%' || substr(i.invoice_number,1,instr(i.invoice_number,'-')-1) || '%'
    ORDER BY i.invoice_date DESC
    LIMIT 1
  )

LEFT JOIN Projects pr ON inv.project_id = pr.projectID
LEFT JOIN ClientsTable cl ON pr.clientID = cl.id

WHERE
  -- current month
  am.month_year = (SELECT m FROM params)

  -- regular carry-forward (past only)
  OR (
    am.regular = 'Yes'
    AND am.month_year < (SELECT m FROM params)
    AND NOT EXISTS (
      SELECT 1 FROM expense_payments ep2
      WHERE ep2.expense_id = am.auto_id
        AND substr(ep2.month_year,1,7) = am.month_year
        AND ep2.status = 'Paid'
    )
  )

  -- GST carry-forward (single row)
  OR (
    am.type = 'GST'
    AND am.month_year < (SELECT m FROM params)
    AND NOT EXISTS (
      SELECT 1 FROM expense_payments ep3
      WHERE ep3.expense_id = am.auto_id
        AND ep3.status = 'Paid'
    )
  )

ORDER BY am.auto_id DESC, am.month_year DESC;
`;

const cleanDescription = (row) => {
  if (!row.type) return row.description;

  // ✅ Salary
  if (row.type.startsWith("Salary")) {
    return `Monthly Salary${
      row.type.includes("(")
        ? " " + row.type.slice(row.type.indexOf("("))
        : ""
    }`;
  }

  // ✅ PF
  if (row.type.startsWith("PF")) {
    return "Provident Fund";
  }

  // ✅ Professional Tax / PT
  if (
    row.type.startsWith("Professional Tax") ||
    row.type === "PT"
  ) {
    return "Professional Tax";
  }

  // ✅ ESI
  if (row.type.startsWith("ESI")) {
    return "ESI Contribution";
  }

  // ❌ GST & others → keep original description
  return row.description;
};


    db.all(sql, [month], (err, rows) => {
      if (err) {
        console.error("DB error:", err);
        return res.status(500).json({ error: err.message });
      }

      const formatted = rows.map(row => ({
        id: `E${row.auto_id}`,
        expense_id: row.auto_id,
        regular: row.regular,
        type: row.type,
       description: cleanDescription(row),



        client_name: row.client_name || null,
        project_name: row.project_name || null,
        invoice_value: row.invoice_value || null,

        amount: row.amount,
        actual_to_pay: row.actual_amount ?? null,
        paid_amount: row.paid_amount ?? 0,
        raised_date: row.raised_date,
        due_date: row.computed_due_date,
        paid_date: row.paid_date || null,
        paymentstatus: row.payment_status || "Pending",
        expensestatus: "Raised",
        month_year: row.month_year
      }));

      res.json(formatted);
    });

  } catch (ex) {
    console.error("Unexpected error:", ex);
    res.status(500).json({ error: "Unexpected server error" });
  }
});


app.post("/postexpenses", (req, res) => {
  try {
    let {
      regular,
      type,
      description,
      amount,
      currency,
      raised_date,
      due_date,
      paid_date,
      paid_amount,
      Active,
      status
    } = req.body;

    // Basic validation
    if (!type || amount == null || !raised_date) {
      return res.status(400).json({ error: "type, amount and raised_date are required" });
    }

    // Normalize regular to 'Yes'/'No' (default 'No')
    regular = String(regular || "No").trim();
    if (!/^(Yes|No)$/i.test(regular)) regular = "No";
    regular = regular[0].toUpperCase() + regular.slice(1).toLowerCase(); // "Yes" or "No"

    // Helper: normalize incoming date formats
    const normalizeToISODate = (d) => {
      if (!d) return null;
      // if YYYY-MM -> convert to YYYY-MM-01
      if (/^\d{4}-\d{2}$/.test(d)) return `${d}-01`;
      // if YYYY-MM-DD -> return as-is
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      // if DD-MM-YYYY -> convert to YYYY-MM-DD (common in your UI)
      if (/^\d{2}-\d{2}-\d{4}$/.test(d)) {
        const [dd, mm, yyyy] = d.split("-");
        return `${yyyy}-${mm}-${dd}`;
      }
      // fallback: try Date parsing
      const parsed = new Date(d);
      if (!isNaN(parsed)) {
        const yyyy = parsed.getFullYear();
        const mm = String(parsed.getMonth() + 1).padStart(2, "0");
        const dd = String(parsed.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      }
      return null;
    };

    raised_date = normalizeToISODate(raised_date);
    due_date = normalizeToISODate(due_date) || raised_date; // fallback to raised_date if missing
    paid_date = normalizeToISODate(paid_date);

    // final field defaults
    currency = currency || "INR";
    status = status || "Raised";

    const insertSql = `
      INSERT INTO expenses (
        regular, type, description, amount, currency,
        raised_date, due_date, paid_date, paid_amount, Active, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    db.run(insertSql, [
      regular, type, description || "", Number(amount) || 0, currency,
      raised_date, due_date, paid_date || null, paid_amount || null, Active || null, status
    ], function (err) {
      if (err) {
        console.error("Error inserting expense:", err);
        return res.status(500).json({ error: "DB error inserting expense" });
      }

      const insertedId = this.lastID;
      // Return the newly inserted row for client to use immediately
      db.get(`SELECT * FROM expenses WHERE auto_id = ? LIMIT 1`, [insertedId], (gErr, row) => {
        if (gErr) {
          console.error("Error fetching inserted expense:", gErr);
          return res.status(500).json({ error: "DB error fetching inserted expense" });
        }
        return res.json({ message: "Expense added", expense: row });
      });
    });
  } catch (ex) {
    console.error("Unexpected error in /postexpenses:", ex);
    res.status(500).json({ error: "Unexpected server error" });
  }
});


app.put("/markaspaid/:id", (req, res) => {
  let { id } = req.params;          // id will be like "E1"
  const { paid_date, paid_amount, status } = req.body;

  // Remove the leading 'E' to get numeric auto_id
  if (id.startsWith("E")) {
    id = parseInt(id.substring(1), 10);
  }

  db.run(
    `UPDATE expenses SET paid_date = ?, paid_amount = ?, status = ? WHERE auto_id = ?`,
    [paid_date, paid_amount, status, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Expense not found" });
      res.json({ message: "Expense marked as paid successfully" });
    }
  );
});

// ✅ Get pending salaries summary

app.get("/api/pending-salaries", (req, res) => {

  const sql =     `SELECT 

      employee_id,

      employee_name,
      paid,
      actual_to_pay,
      

      COUNT(month) AS pending_months_count,

      GROUP_CONCAT(month, ', ') AS pending_months

    FROM monthly_salary_payments

    WHERE paid = 'No'

    GROUP BY employee_id, employee_name

    ORDER BY employee_name;`
;

  db.all(sql, [], (err, rows) => {

    if (err) {

      console.error("Error fetching pending salaries:", err);

      res.status(500).json({ success: false, message: "Database error" });

    } else {

      res.json({ success: true, data: rows });

      console.log(rows)

    }

  });

});
 
app.put("/updateexpense/:id", (req, res) => {
  let { id } = req.params;
  const {
    regular,
    amount,
    raised_date,
    due_date,
    status,
    month_year, // must be sent from frontend: format "YYYY-MM"
  } = req.body;

  id = id.replace("E", ""); // convert E9 → 9

  // 1️⃣ Update base expense details
  const updateExpenseSql = `
    UPDATE expenses
    SET regular = ?, amount = ?, raised_date = ?, due_date = ?, status = ?
    WHERE auto_id = ?
  `;

  db.run(updateExpenseSql, [regular, amount, raised_date, due_date, status, id], function (err) {
    if (err) {
      console.error("Error updating expenses:", err.message);
      return res.status(500).json({ error: err.message });
    }

    // 2️⃣ Update or insert status in expense_payments
    const updatePaymentSql = `
      INSERT INTO expense_payments (expense_id, month_year, actual_amount, status)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(expense_id, month_year)
      DO UPDATE SET status = excluded.status
    `;

    db.run(updatePaymentSql, [id, month_year, amount, status], function (err2) {
      if (err2) {
        console.error("Error updating expense_payments:", err2.message);
        return res.status(500).json({ error: err2.message });
      }

      res.json({ message: "Expense and payment status updated successfully!" });
    });
  });
});

// // ✅ Create Account API
app.post("/accounts", (req, res) => {
  const { account_number, account_name, account_type, balance } = req.body;

  // Validate input
  if (!account_number || !account_name || !account_type) {
    return res.status(400).json({ error: "All fields are required" });
  }

  if (!["Capital", "Current","Kityy"].includes(account_type)) {
    return res.status(400).json({ error: "Invalid account type" });
  }

  // Insert into DB
  const sql = `
    INSERT INTO accounts (account_number, account_name, account_type, balance)
    VALUES (?, ?, ?, ?)
  `;

  db.run(sql, [account_number, account_name, account_type, balance || 0], function (err) {
    if (err) {
      if (err.message.includes("UNIQUE constraint")) {
        return res.status(400).json({ error: "Account number already exists" });
      }
      return res.status(500).json({ error: err.message });
    }

    // Respond success
    res.status(201).json({
      message: "✅ Account created successfully",
      account: {
        account_id: this.lastID,
        account_number,
        account_name,
        account_type,
        balance: balance || 0,
      },
    });
  });
});

// 🔹 Get All Accounts
app.get("/accounts", (req, res) => {
  db.all(`SELECT * FROM accounts`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
// 🔹 Get Transaction History (Joined)
app.get("/transactionsOfBankAccounts", (req, res) => {
  const { account_number } = req.query;

  if (!account_number) {
    return res.status(400).json({ error: "Account number is required" });
  }

  db.all(
    `
    SELECT 
      transaction_id,
      account_number,
      type,
      description,
      amount,
      previous_balance,
      updated_balance,
      created_at
    FROM transactions
    WHERE account_number = ?
    ORDER BY datetime(created_at) DESC
    `,
    [account_number],
    (err, rows) => {
      if (err) {
        console.error("Error fetching transactions:", err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows);
    }
  );
});

// 🔹 Get Account Balance
app.get("/accounts/:number/balance", (req, res) => {
  db.get(`SELECT balance FROM accounts WHERE account_number = ?`, [req.params.number], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "Not found" });
    res.json({ account_number: req.params.number, balance: row.balance });
  });
});


app.patch("/accounts/:number/add-balance", (req, res) => {
  const { amount } = req.body;
  const { number } = req.params;

  if (!amount || amount <= 0)
    return res.status(400).json({ error: "Invalid amount" });

  db.get(
    `SELECT balance, account_name FROM accounts WHERE account_number = ?`,
    [number],
    (err, acc) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!acc) return res.status(404).json({ error: "Account not found" });

      const prevBal = Number(acc.balance || 0);
      const updatedBal = prevBal + Number(amount);

      const now = new Date();
      const timestamp = formatTimestamp(now); // 20251203-15:00:31
      const random = rand4();                 // 88ld
      const last3 = String(number).slice(-3);

      const txId = `crd|MANUAL|${last3}|${timestamp}|${random}`;

      // Update account balance
      db.run(
        `UPDATE accounts SET balance = ? WHERE account_number = ?`,
        [updatedBal, number],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0)
            return res.status(404).json({ error: "Account not found" });

          // Insert into transactions
          const insertSql = `
            INSERT INTO transactions
              (transaction_id, account_number, type, description, amount,
               previous_balance, updated_balance, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `;

          db.run(
            insertSql,
            [
              txId,
              number,
              "Credit",
              "Manual Balance Addition",
              amount,
              prevBal,
              updatedBal,
              now.toISOString()
            ],
            function (err) {
              if (err) return res.status(500).json({ error: err.message });

              return res.json({
                message: "Balance updated successfully",
                transaction_id: txId,
                previous_balance: prevBal,
                updated_balance: updatedBal,
              });
            }
          );
        }
      );
    }
  );
});

const crypto = require('crypto'); // at top of file

// at top of file (if not already present)
function formatTimestamp(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}-${hh}:${mm}:${ss}`;
}

function cleanName(name) {
  if (!name) return "NA";
  return name.replace(/\|/g, "-").trim();
}

function rand4() {
  return Math.random().toString(36).substring(2, 6);
}

function buildTxId(prefix, accountName, accountNumber, timestamp, random) {
  const last3 = String(accountNumber).slice(-3);
  return `${prefix}|${cleanName(accountName)}|${last3}|${timestamp}|${random}`;
}

function sanitizeForId(s) {
  if (!s) return "UNKNOWN";
  // remove pipes and vertical bars, collapse whitespace, trim
  return String(s).replace(/\|/g, "-").replace(/\s+/g, " ").trim();
}

function shortRandom(n = 5) {
  return Math.random().toString(36).slice(2, 2 + n);
}

app.post("/accounts/transfer", (req, res) => {
  const { from_account, to_account, amount, description } = req.body;

  if (!from_account || !to_account || !amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid transfer details" });
  }
  if (from_account === to_account) {
    return res.status(400).json({ error: "Cannot transfer to the same account" });
  }

  db.serialize(() => {
    db.get(
      `SELECT balance, account_name FROM accounts WHERE account_number = ?`,
      [from_account],
      (err, senderRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!senderRow) return res.status(404).json({ error: "Sender not found" });

        if (senderRow.balance < amount) {
          return res.status(400).json({ error: "Insufficient balance" });
        }

        db.get(
          `SELECT balance, account_name FROM accounts WHERE account_number = ?`,
          [to_account],
          (err, recvRow) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!recvRow) return res.status(404).json({ error: "Receiver not found" });

            const now = new Date();
            const ts = formatTimestamp(now);     // 20251203-15:00:31
            const random = rand4();              // 88ld
            const descText = description || `Transfer from ${from_account} to ${to_account}`;

            const senderPrev = Number(senderRow.balance);
            const senderUpdated = senderPrev - Number(amount);

            const recvPrev = Number(recvRow.balance);
            const recvUpdated = recvPrev + Number(amount);

            // Build IDs exactly like you want
            const senderTxId = buildTxId("deb", senderRow.account_name, from_account, ts, random);
            const receiverTxId = buildTxId("crd", recvRow.account_name, to_account, ts, random);

            db.run("BEGIN TRANSACTION", (trxErr) => {
              if (trxErr) return res.status(500).json({ error: trxErr.message });

              // Update sender balance
              db.run(
                `UPDATE accounts SET balance = ? WHERE account_number = ?`,
                [senderUpdated, from_account],
                function (err) {
                  if (err) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: err.message });
                  }

                  // Update receiver balance
                  db.run(
                    `UPDATE accounts SET balance = ? WHERE account_number = ?`,
                    [recvUpdated, to_account],
                    function (err) {
                      if (err) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: err.message });
                      }

                      const insertSql = `
                        INSERT INTO transactions
                          (transaction_id, account_number, type, description, amount, previous_balance, updated_balance, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                      `;

                      // Sender entry (debit)
                      db.run(
                        insertSql,
                        [
                          senderTxId,
                          from_account,
                          "Debit",
                          descText,
                          amount,
                          senderPrev,
                          senderUpdated,
                          now.toISOString()
                        ],
                        function (err) {
                          if (err) {
                            db.run("ROLLBACK");
                            return res.status(500).json({ error: err.message });
                          }

                          // Receiver entry (credit)
                          db.run(
                            insertSql,
                            [
                              receiverTxId,
                              to_account,
                              "Credit",
                              descText,
                              amount,
                              recvPrev,
                              recvUpdated,
                              now.toISOString()
                            ],
                            function (err) {
                              if (err) {
                                db.run("ROLLBACK");
                                return res.status(500).json({ error: err.message });
                              }

                              db.run("COMMIT", (commitErr) => {
                                if (commitErr) {
                                  return res.status(500).json({ error: commitErr.message });
                                }
                                res.json({
                                  message: "Transfer successful",
                                  transaction_ids: {
                                    sender: senderTxId,
                                    receiver: receiverTxId
                                  }
                                });
                              });
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            });
          }
        );
      }
    );
  });
});



// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------
function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error("❌ SQL Error:", err.message, "\nQuery:", sql);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

function monthKey(dateStr) {
  if (!dateStr) return null;
  return dateStr.slice(0, 7); // YYYY-MM
}




// --- helper: find payment for a specific expense in this exact month (monthKey = "YYYY-MM")
const findPaymentForMonth = (expenseId, monthKey) => {
  const list = paymentsByExpenseId[expenseId] || [];
  // exact month_year match preferred
  let exact = list.find(p => p.month_year === monthKey);
  if (exact) return exact;
  // else prefer any row with paid_date in the same month
  let byPaidDate = list.find(p => p.paid_date && p.paid_date.slice(0,7) === monthKey);
  if (byPaidDate) return byPaidDate;
  return null;
};


app.get("/forecast", async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) throw new Error("Database not initialized");

    const runQuery = (sql, params = []) =>
      new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
      );

    const today = new Date();
    const startYear = today.getFullYear();
    const endYear = today.getFullYear() + 1;

    const generateMonthRange = (start, end) => {
      const result = [];
      const [sy, sm] = start.split("-").map(Number);
      const [ey, em] = end.split("-").map(Number);
      let y = sy, m = sm;
      while (y < ey || (y === ey && m <= em)) {
        result.push(`${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}`);
        m++;
        if (m === 13) { m = 1; y++; }
      }
      return result;
    };

    const monthKeys = generateMonthRange(`${startYear}-01`, `${endYear}-12`);

    // fetch static data (projects / invoices / actual received invoices)
    const projects = await runQuery(
      `SELECT projectID, projectName, startDate, endDate, netPayable, invoiceCycle, active
       FROM Projects`
    );

    const invoices = await runQuery(
      `SELECT id, invoice_number, project_id, invoice_value, gst_amount, due_date, received
       FROM invoices WHERE due_date IS NOT NULL`
    );

    const actualReceivedInvoices = await runQuery(
      `SELECT id, invoice_number, project_id, invoice_value, gst_amount, received_date
       FROM invoices WHERE received = 'Yes' AND received_date IS NOT NULL`
    );

    // build invoice maps used for income forecast
    const invoicesByDueMonth = {};
    invoices.forEach(inv => {
      const m = inv.due_date?.slice(0, 7);
      if (m) (invoicesByDueMonth[m] ||= []).push(inv);
    });
    const actualReceivedByMonth = {};
    actualReceivedInvoices.forEach(inv => {
      const m = inv.received_date?.slice(0, 7);
      if (m) (actualReceivedByMonth[m] ||= []).push(inv);
    });

    // Helper: call the same SQL used in /getexpenses to get normalized rows for a specific month.
    // NOTE: this SQL is identical to your /getexpenses CTE pipeline - it returns payment fields:
    //   actual_amount, paid_amount, paid_date, payment_status, payment_due_date, payment_month, etc.
    const fetchExpensesForMonth = async (month) => {
      const sql = `
WITH params(m) AS (SELECT ? AS m),

expenses_norm AS (
  SELECT 
    e.*,
    CASE 
      WHEN e.regular = 'Yes' THEN substr(e.raised_date,1,7)
      ELSE COALESCE(NULLIF(substr(e.due_date,1,7), ''), substr(e.raised_date,1,7))
    END AS orig_ym
  FROM expenses e
),

months_gen AS (
  SELECT 
    en.auto_id,
    en.regular,
    en.type,
    en.description,
    en.amount,
    en.currency,
    en.orig_ym AS month_year,
    en.orig_ym,
    en.raised_date,
    en.due_date AS expense_due_date,
    en.status AS expense_status,
    en.paid_date AS expense_paid_date,
    en.paid_amount AS expense_paid_amount
  FROM expenses_norm en
  WHERE en.regular = 'Yes'
    AND en.orig_ym <= (SELECT m FROM params)

  UNION ALL

  SELECT 
    mg.auto_id,
    mg.regular,
    mg.type,
    mg.description,
    mg.amount,
    mg.currency,
    CASE
      WHEN substr(mg.month_year,6,2) = '12'
        THEN printf('%04d-01', CAST(substr(mg.month_year,1,4) AS INTEGER) + 1)
      ELSE printf('%04d-%02d',
             CAST(substr(mg.month_year,1,4) AS INTEGER),
             CAST(substr(mg.month_year,6,2) AS INTEGER) + 1)
    END AS month_year,
    mg.orig_ym,
    mg.raised_date,
    mg.expense_due_date,
    mg.expense_status,
    mg.expense_paid_date,
    mg.expense_paid_amount
  FROM months_gen mg
  WHERE mg.month_year < (SELECT m FROM params)
),

single_months AS (
  SELECT 
    en.auto_id,
    en.regular,
    en.type,
    en.description,
    en.amount,
    en.currency,
    (SELECT m FROM params) AS month_year,
    en.orig_ym,
    en.raised_date,
    en.due_date AS expense_due_date,
    en.status AS expense_status,
    en.paid_date AS expense_paid_date,
    en.paid_amount AS expense_paid_amount
  FROM expenses_norm en
  WHERE en.regular <> 'Yes'
    AND (
         en.orig_ym = (SELECT m FROM params)
         OR NOT EXISTS (
              SELECT 1 FROM expense_payments ep
              WHERE ep.expense_id = en.auto_id
                AND substr(ep.month_year,1,7) = en.orig_ym
                AND ep.status = 'Paid'
         )
    )
),

all_months AS (
  SELECT * FROM months_gen
  UNION ALL
  SELECT * FROM single_months
)

SELECT 
  am.*,
  ep.actual_amount,
  COALESCE(ep.paid_amount, am.expense_paid_amount) AS paid_amount,
  COALESCE(ep.paid_date, am.expense_paid_date) AS paid_date,
  COALESCE(ep.status, am.expense_status) AS payment_status,
  ep.due_date AS payment_due_date,
  ep.month_year AS payment_month
FROM all_months am
LEFT JOIN expense_payments ep
  ON ep.expense_id = am.auto_id
  AND ep.month_year IS NOT NULL
  AND substr(ep.month_year,1,7) = am.month_year

WHERE
  am.month_year = (SELECT m FROM params)
  OR NOT EXISTS (
    SELECT 1 FROM expense_payments ep2
    WHERE ep2.expense_id = am.auto_id
      AND substr(ep2.month_year,1,7) = am.month_year
      AND ep2.status = 'Paid'
  )

ORDER BY am.auto_id DESC, am.month_year DESC;
`;
      const rows = await runQuery(sql, [month]);
      // normalize minimal fields for JS usage
      return rows.map(r => ({
        auto_id: r.auto_id,
        regular: r.regular,
        type: r.type,
        description: r.description,
        amount: r.amount != null ? Number(r.amount) : 0,
        expense_due_date: r.expense_due_date || null,
        payment_due_date: r.payment_due_date || null,
        actual_amount: r.actual_amount != null ? Number(r.actual_amount) : null,
        paid_amount: r.paid_amount != null ? Number(r.paid_amount) : null,
        paid_date: r.paid_date || null,
        payment_status: r.payment_status || null,
        payment_month: r.payment_month ? String(r.payment_month).slice(0,7) : null,
        month_year: r.month_year, // the generated month this row refers to
      }));
    }; // end fetchExpensesForMonth

    // projects/invoices used for income forecasting (unchanged) ----------------
    const months = [];

    for (const monthKey of monthKeys) {
      // fetch expenses for this specific month using the /getexpenses SQL logic
      const expenseRows = await fetchExpensesForMonth(monthKey);

      const forecastExpenseItems = [];
      const actualExpenseItems = [];

      // split into actual vs forecast using payment_status and payment_month
      expenseRows.forEach(r => {
        // if payment_status === 'Paid' AND payment_month === monthKey -> actual paid row
        const isPaidThisMonth = String(r.payment_status || "").toLowerCase() === "paid"
                                && r.payment_month === monthKey;

        if (isPaidThisMonth) {
          // treat as an actual paid expense row for this month
          const paidAmount = r.paid_amount != null ? Number(r.paid_amount) :
                             (r.actual_amount != null ? Number(r.actual_amount) : Number(r.amount || 0));
          actualExpenseItems.push({
            expense_id: r.auto_id,
            type: r.type,
            description: r.description,
            amount: paidAmount,
            paid_amount: paidAmount,
            actual_amount: r.actual_amount,
            due_date: r.payment_due_date || r.expense_due_date || null,
            paid_date: r.paid_date || null,
            regular: r.regular,
            status: r.payment_status || "Paid",
          });
        } else {
          // forecast item (either regular recurring for this month, or one-time unpaid carried forward)
          // use payment_due_date (if any) else expense_due_date else use month's first day
          const effective_due_date = r.payment_due_date || r.expense_due_date || `${monthKey}-01`;
          const paidAmount = r.paid_amount != null ? Number(r.paid_amount) :
                             (r.actual_amount != null ? Number(r.actual_amount) : 0);
          forecastExpenseItems.push({
            expense_id: r.auto_id,
            type: r.type,
            description: r.description,
            amount: Number(r.amount || 0),
            regular: r.regular,
            original_due_date: r.expense_due_date || null,
            effective_due_date,
            due_date: r.payment_due_date || r.expense_due_date || null,
            paid_amount: paidAmount,
            paid_date: r.paid_date || null,
            status: r.payment_status || "Unpaid",
          });
        }
      });

      const actualExpenseTotal = actualExpenseItems.reduce((s, a) => s + (Number(a.amount) || 0), 0);
      const forecastExpenseTotal = forecastExpenseItems.reduce((s, a) => s + Number(a.paid_amount || a.amount || 0), 0);

      // income: actual / forecast (unchanged from your previous logic)
      const actualIncomeItems =
        (actualReceivedByMonth[monthKey] || []).map(inv => ({
          invoice_id: inv.id,
          invoice_number: inv.invoice_number,
          project_id: inv.project_id,
          invoice_value: Number(inv.invoice_value),
          total_with_gst: Number(inv.invoice_value),
          gst_amount: Number(inv.gst_amount || 0),
          received_date: inv.received_date,
        })) || [];

      const actualIncomeTotal = actualIncomeItems.reduce((s, a) => s + a.total_with_gst, 0);

      const forecastIncomeItems = (invoicesByDueMonth[monthKey] || []).map(inv => ({
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        project_id: inv.project_id,
        invoice_value: Number(inv.invoice_value),
        total_with_gst: Number(inv.invoice_value),
        gst_amount: Number(inv.gst_amount || 0),
        due_date: inv.due_date,
      }));

      // project-based forecasts (unchanged)
      const forecastIncomeItemsCopy = [...forecastIncomeItems];
      projects.forEach((p) => {
        const netPayable = Number(p.netPayable || p.net_payable || 0);
        if (!netPayable || netPayable <= 0) return;
        const startMonth = p.startDate ? String(p.startDate).slice(0, 7) : null;
        const endMonth = p.endDate ? String(p.endDate).slice(0, 7) : null;
        if (startMonth && monthKey < startMonth) return;
        if (endMonth && monthKey > endMonth) return;
        const cycle = String(p.invoiceCycle || "Monthly").toLowerCase();
        if (cycle === "quarterly" && startMonth) {
          const [sy, sm] = startMonth.split("-").map(Number);
          const [cy, cm] = monthKey.split("-").map(Number);
          const diff = (cy - sy) * 12 + (cm - sm);
          if (diff % 3 !== 0) return;
        }
        const invoiceExists = (invoicesByDueMonth[monthKey] || []).some(inv => inv.project_id === p.projectID);
        if (invoiceExists) return;
        forecastIncomeItemsCopy.push({
          project_id: p.projectID,
          projectName: p.projectName,
          invoice_value: netPayable,
          total_with_gst: netPayable,
          gst_amount: 0,
          note: "project forecast",
        });
      });

      const forecastIncomeTotal = forecastIncomeItemsCopy.reduce((s, a) => s + Number(a.total_with_gst || a.invoice_value || a.amount || 0), 0);

      months.push({
        month: monthKey,
        actualIncomeTotal,
        actualIncomeItems,
        forecastIncomeTotal,
        forecastIncomeItems: forecastIncomeItemsCopy,
        actualExpenseTotal,
        actualExpenseItems,
        forecastExpenseTotal,
        forecastExpenseItems,
        monthlyBalance: forecastIncomeTotal - forecastExpenseTotal,
      });
    } // end month loop

    return res.json({
      success: true,
      message: "Forecast generated successfully",
      months,
    });
  } catch (err) {
    console.error("❌ Forecast Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});


app.get("/monthly-last-balances", (req, res) => {
  const { month } = req.query; // YYYY-MM
 
  if (!month) {
    return res.status(400).json({
      success: false,
      message: "month is required (YYYY-MM)"
    });
  }
 
  const sql = `
    SELECT
      strftime('%Y-%m', t.created_at) AS month,
      t.updated_balance
    FROM transactions t
    JOIN accounts a ON t.account_number = a.account_number
    WHERE a.account_type = 'Current'
      AND strftime('%Y-%m', t.created_at) = ?
    ORDER BY t.created_at DESC
    LIMIT 1;
  `;
 
  req.app.locals.db.get(sql, [month], (err, row) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
 
    res.json({
      success: true,
      data: row ? [row] : []
    });
  });
});


// -----------------------------------------------------------------------------
// 📅 Forecast Details for a Specific Date (Net Cash Flow = Account + Forecast Adjustments)
// -----------------------------------------------------------------------------
app.get("/forecast/details", async (req, res) => {
  const db = req.app.locals.db;
  if (!db) return res.status(500).json({ error: "Database not initialized" });

  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "Missing 'date' query param" });

  console.log(`🔍 Fetching forecast details for ${date}`);

  const safeQuery = async (label, query, params = []) => {
    try {
      const result = await runQuery(db, query, params);
      console.log(`✅ ${label}: ${result.length} rows`);
      return result;
    } catch (err) {
      console.error(`❌ Query failed [${label}]:`, err.message);
      return [];
    }
  };

  try {
    // ✅ 1️⃣ Actual Income (received already — for info only)
    const actualIncome = await safeQuery(
      "Actual Income",
      `
      SELECT 
        client_name,
        invoice_number,
        project_id,
        invoice_value,
        gst_amount,
        received_date
      FROM invoices
      WHERE received = 'Yes'
        AND date(received_date) = date(?);
      `,
      [date]
    );

    // 📈 2️⃣ Forecasted Income (due but not received)
    const forecastedIncome = await safeQuery(
      "Forecasted Income",
      `
      SELECT 
        client_name,
        invoice_number,
        project_id,
        invoice_value,
        gst_amount,
        due_date
      FROM invoices
      WHERE received = 'No'
        AND date(due_date) = date(?);
      `,
      [date]
    );

    // 💸 3️⃣ Actual Expenses (already reflected — info only)
    const actualExpenses = await safeQuery(
      "Actual Expenses",
      `
      SELECT 
        e.type AS expense_type,
        e.description,
        ep.paid_amount,
        ep.paid_date
      FROM expense_payments ep
      JOIN expenses e ON e.auto_id = ep.expense_id
      WHERE ep.status = 'Paid'
        AND date(ep.paid_date) = date(?);
      `,
      [date]
    );

    // 🧾 4️⃣ Forecasted Expenses (unpaid)
    const forecastedExpenses = await safeQuery(
      "Forecasted Expenses",
      `
      SELECT 
        e.type AS expense_type,
        e.description,
        e.amount,
        e.currency,
        e.regular,
        e.due_date
      FROM expenses e
      WHERE date(e.due_date) = date(?)
        AND e.auto_id NOT IN (
          SELECT expense_id FROM expense_payments WHERE status = 'Paid'
        );
      `,
      [date]
    );

    // 👤 5️⃣ Salaries (paid or forecasted)
    const salaries = await safeQuery(
      "Salaries",
      `
      SELECT 
        e.employee_name,
        e.employee_id,
        msp.paid_amount,
        msp.paid_date,
        msp.month
      FROM employees e
      LEFT JOIN monthly_salary_payments msp
        ON LOWER(TRIM(e.employee_id)) = LOWER(TRIM(msp.employee_id))
      WHERE 
        (msp.paid_date IS NOT NULL AND date(msp.paid_date) = date(?))
        OR (e.date_of_joining IS NOT NULL AND date(e.date_of_joining) = date(?));
      `,
      [date, date]
    );

    // 💰 Totals
    const forecastedIncomeTotal = forecastedIncome.reduce(
      (sum, i) => sum + (Number(i.invoice_value) + Number(i.gst_amount || 0)),
      0
    );
    const forecastedExpensesTotal = forecastedExpenses.reduce(
      (sum, e) => sum + Number(e.amount || 0),
      0
    );
    const forecastedSalariesTotal = salaries
      .filter((s) => !s.paid_date) // only unpaid salaries
      .reduce((sum, s) => sum + Number(s.paid_amount || 0), 0);

    // 🏦 6️⃣ Current Account Balance
    const currentAccountRow = await safeQuery(
      "Current Account Balance",
      `
      SELECT account_name, account_number, balance
      FROM accounts
      WHERE LOWER(account_type) = 'current'
      LIMIT 1;
      `
    );

    const currentAccountBalance =
      currentAccountRow.length > 0
        ? Number(currentAccountRow[0].balance || 0)
        : 0;

    // 🧮 7️⃣ Net Cash Flow (forecast projection only)
    const inflows = forecastedIncomeTotal;
    const outflows = forecastedExpensesTotal + forecastedSalariesTotal;
    const monthlyBalance = currentAccountBalance + inflows - outflows;

    // ✅ Response
    res.json({
      date,
      summary: {
        currentAccountBalance,
        forecastedIncomeTotal,
        forecastedExpensesTotal,
        forecastedSalariesTotal,
        inflows,
        outflows,
        monthlyBalance,
      },
      details: {
        actualIncome,
        forecastedIncome,
        actualExpenses,
        forecastedExpenses,
        salaries,
      },
    });

    console.log(
      `✅ Forecast-only Cash Flow for ${date}: ₹${monthlyBalance.toLocaleString()}`
    );
  } catch (err) {
    console.error("❌ Forecast Details API Fatal Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 📈 MONTHLY SUMMARY ENDPOINT (aligned with /forecast)
// -----------------------------------------------------------------------------
app.get("/monthly-summary", async (req, res) => {
  try {
    console.log("📊 Monthly Summary API Called");

    const db = req.app.locals.db;
    if (!db) throw new Error("Database not initialized");

    const today = new Date();
    const currentMonthKey = today.toISOString().slice(0, 7);

    const transactions = await runQuery(db, `
      SELECT 
        strftime('%Y-%m', created_at) AS month,
        SUM(CASE WHEN type='Credit' THEN amount ELSE 0 END) AS credit_total,
        SUM(CASE WHEN type='Debit' THEN amount ELSE 0 END) AS debit_total
      FROM transactions
      GROUP BY month;
    `);

    const summaryMap = {};
    transactions.forEach(r => {
      if (!r.month) return;
      summaryMap[r.month] = {
        month: r.month,
        credit_total: Number(r.credit_total || 0),
        debit_total: Number(r.debit_total || 0),
        forecast: false
      };
    });

    const projects = await runQuery(db, `
      SELECT startDate, endDate, netPayable AS monthlyBilling
      FROM Projects WHERE active='Yes';
    `);

    const salaryRows = await runQuery(db, `
      SELECT employee_id, strftime('%Y-%m', paid_date) AS month, SUM(paid_amount) AS paid
      FROM monthly_salary_payments
      WHERE paid='Yes' AND paid_date IS NOT NULL
      GROUP BY employee_id, month;
    `);

    const salariesMap = {};
    salaryRows.forEach(s => {
      if (!s.month) return;
      if (!salariesMap[s.employee_id]) salariesMap[s.employee_id] = {};
      salariesMap[s.employee_id][s.month] = Number(s.paid || 0);
    });

    const forecastMonths = 6;
    const forecastMonthsArr = [];
    for (let i = 0; i < forecastMonths; i++) {
      const m = new Date(today);
      m.setMonth(today.getMonth() + i);
      forecastMonthsArr.push(m.toISOString().slice(0, 7));
    }

    forecastMonthsArr.forEach(monthKey => {
      if (monthKey < currentMonthKey) return;

      let projectIncome = 0;
      let projectExpense = 0;

      projects.forEach(p => {
        const start = p.startDate?.slice(0, 7);
        const end = p.endDate?.slice(0, 7);
        if (start && monthKey >= start && (!end || monthKey <= end))
          projectIncome += Number(p.monthlyBilling || 0);
      });

      Object.keys(salariesMap).forEach(empId => {
        if (salariesMap[empId][monthKey]) {
          projectExpense += salariesMap[empId][monthKey];
        } else {
          const paidMonths = Object.keys(salariesMap[empId]).sort().slice(-3);
          const avg = paidMonths.length
            ? paidMonths.reduce((s, m) => s + salariesMap[empId][m], 0) / paidMonths.length
            : 0;
          projectExpense += avg;
        }
      });

      summaryMap[monthKey] = {
        month: monthKey,
        credit_total: projectIncome,
        debit_total: projectExpense,
        forecast: true
      };
    });

    const summary = Object.values(summaryMap).sort((a, b) =>
      a.month.localeCompare(b.month)
    );
    const actual = summary.filter(m => m.month <= currentMonthKey);
    const forecast = summary.filter(m => m.month > currentMonthKey);

    res.json({
      success: true,
      currentMonth: currentMonthKey,
      actual,
      forecast,
      all: summary
    });

    console.log("✅ Monthly Summary Prepared for", currentMonthKey);
  } catch (err) {
    console.error("❌ Error in /monthly-summary:", err);
    res.status(500).json({
      success: false,
      message: err.message,
      actual: [],
      forecast: []
    });
  }
});



// -----------------------------------------------------------------------------
// 💰 UPDATE / ADD MONTHLY SALARY RECORD
// -----------------------------------------------------------------------------
app.put("/update-salary/:employee_id", (req, res) => {
  const { employee_id } = req.params;
  const { month, actual_to_pay, due_date } = req.body;

  if (!employee_id || !month || !actual_to_pay || !due_date) {
    return res.status(400).json({
      error: "Employee ID, month, actual_to_pay, and due_date are required.",
    });
  }

  const formattedMonth = month.slice(0, 7);

  const checkQuery = `
    SELECT * FROM monthly_salary_payments
    WHERE employee_id = ? AND month = ?
  `;

  db.get(checkQuery, [employee_id, formattedMonth], (err, record) => {
    if (err) {
      console.error("❌ Error checking salary record:", err);
      return res.status(500).json({ error: "Database check failed." });
    }

    if (record) {
      // --------------------------------------------------------------------
      // 🔥 Step 1: UPDATE existing monthly_salary_payments
      // --------------------------------------------------------------------
      const updateQuery = `
        UPDATE monthly_salary_payments
        SET actual_to_pay = ?, due_date = ?, paid = 'No', paid_amount = 0
        WHERE employee_id = ? AND month = ?
      `;

      db.run(updateQuery, [actual_to_pay, due_date, employee_id, formattedMonth], function (err) {
        if (err) {
          console.error("❌ Error updating salary:", err);
          return res.status(500).json({ error: "Failed to update salary record." });
        }

        // Continue to update expenses_payment
        handleExpensePaymentUpdate(employee_id, formattedMonth, actual_to_pay, due_date);
        res.json({
          success: true,
          message: "Salary updated & expense payment updated.",
        });
      });

    } else {
      // --------------------------------------------------------------------
      // 🔥 Step 2: INSERT new monthly_salary_payments
      // --------------------------------------------------------------------
      const getEmployeeQuery = `SELECT employee_name FROM salary_payments WHERE employee_id = ?`;

      db.get(getEmployeeQuery, [employee_id], (err, emp) => {
        if (err || !emp) {
          console.error("❌ Error fetching employee name:", err);
          return res.status(404).json({ error: "Employee not found in salary_payments table." });
        }

        const insertQuery = `
          INSERT INTO monthly_salary_payments
          (employee_id, employee_name, month, actual_to_pay, due_date, paid, paid_amount)
          VALUES (?, ?, ?, ?, ?, 'No', 0)
        `;

        db.run(insertQuery, [employee_id, emp.employee_name, formattedMonth, actual_to_pay, due_date], function (err) {
          if (err) {
            console.error("❌ Error inserting new salary:", err);
            return res.status(500).json({ error: "Failed to insert salary record." });
          }

          // Continue to update expenses_payment
          handleExpensePaymentUpdate(employee_id, formattedMonth, actual_to_pay, due_date);

          res.json({
            success: true,
            message: "Salary created & expense payment inserted.",
          });
        });
      });
    }
  });
});


// ======================================================================
// ⭐ FUNCTION TO INSERT OR UPDATE expense_payments
// ======================================================================
function handleExpensePaymentUpdate(employee_id, month_year, actual_to_pay, due_date) {
  // Fetch employee name to match expenses.type
  const empQuery = `SELECT employee_name FROM salary_payments WHERE employee_id = ?`;

  db.get(empQuery, [employee_id], (err, emp) => {
    if (err || !emp) {
      return console.error("❌ Employee not found for expense mapping.");
    }

    const typePattern = `Salary - ${emp.employee_name} (${employee_id})`;

    // 1️⃣ Find matching expense entry
    const findExpenseQuery = `
      SELECT auto_id FROM expenses
      WHERE type = ?
    `;

    db.get(findExpenseQuery, [typePattern], (err, expense) => {
      if (err || !expense) {
        return console.error("❌ Matching expense not found for:", typePattern);
      }

      const expense_id = expense.auto_id;

      // 2️⃣ Check if expense_payments entry exists
      const checkExpensePayQuery = `
        SELECT * FROM expense_payments
        WHERE expense_id = ? AND month_year = ?
      `;

      db.get(checkExpensePayQuery, [expense_id, month_year], (err, rec) => {
        if (err) {
          return console.error("❌ Error checking expense_payments:", err);
        }

        if (rec) {
          // 3️⃣ UPDATE existing expense_payment
          const updateExpensePay = `
            UPDATE expense_payments
            SET actual_amount = ?, due_date = ?, status = 'Raised'
            WHERE expense_id = ? AND month_year = ?
          `;

          db.run(updateExpensePay, [actual_to_pay, due_date, expense_id, month_year], (err) => {
            if (err) console.error("❌ Error updating expense_payments:", err);
          });

        } else {
          // 4️⃣ INSERT new expense_payment
          const insertExpensePay = `
            INSERT INTO expense_payments 
            (expense_id, month_year, actual_amount, paid_amount, paid_date, status, remarks, due_date)
            VALUES (?, ?, ?, NULL, NULL, 'Raised', NULL, ?)
          `;

          db.run(insertExpensePay, [expense_id, month_year, actual_to_pay, due_date], (err) => {
            if (err) console.error("❌ Error inserting expense_payments:", err);
          });
        }
      });
    });
  });
}

// -----------------------------------------------------------------------------
// 💰 ADD MONTHLY Expense RECORD
// -----------------------------------------------------------------------------

app.post("/saveExpensePayment", (req, res) => {
  try {
    let { expense_id, month_year, actual_amount, due_date, paid_amount, paid_date, status } = req.body;

    if (!expense_id || !month_year || actual_amount == null || !due_date) {
      return res.status(400).json({
        error: "expense_id, month_year, actual_amount, due_date are required."
      });
    }

    // Normalize month_year -> YYYY-MM (accept YYYY-MM-DD or YYYY-MM)
    if (/^\d{4}-\d{2}-\d{2}$/.test(month_year)) month_year = month_year.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month_year)) {
      return res.status(400).json({ error: "month_year must be YYYY-MM or YYYY-MM-DD" });
    }

    // Normalize due_date -> YYYY-MM-DD (if user passed YYYY-MM, make it first day)
    if (/^\d{4}-\d{2}$/.test(due_date)) due_date = `${due_date}-01`;

    // Normalize paid_date similarly
    if (paid_date && /^\d{4}-\d{2}$/.test(paid_date)) paid_date = `${paid_date}-01`;
    if (paid_date && /^\d{2}-\d{2}-\d{4}$/.test(paid_date)) {
      const [dd, mm, yyyy] = paid_date.split("-");
      paid_date = `${yyyy}-${mm}-${dd}`;
    }

    // Default status for a saved payment record (frontend should pass "Paid" when actually paying)
    status = status || "Raised";

    // Build upsert - store paid_amount and paid_date if provided, else keep null
    const expenseSQL = `
      INSERT INTO expense_payments (
        expense_id, month_year, actual_amount, paid_amount, paid_date, status, due_date
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(expense_id, month_year)
      DO UPDATE SET
        actual_amount = excluded.actual_amount,
        paid_amount = excluded.paid_amount,
        paid_date = excluded.paid_date,
        status = excluded.status,
        due_date = excluded.due_date;
    `;

    db.run(expenseSQL, [
      expense_id,
      month_year,
      actual_amount,
      paid_amount || null,
      paid_date || null,
      status,
      due_date
    ], function (err) {
      if (err) {
        console.error("Error saving expense_payment:", err);
        return res.status(500).send("DB error while saving expense_payment");
      }

      // Return the new/updated payment row for debugging and client verification
      db.get(`SELECT * FROM expense_payments WHERE expense_id = ? AND month_year = ?`, [expense_id, month_year], (pErr, paymentRow) => {
        if (pErr) {
          console.error("Error fetching inserted payment:", pErr);
        }

        // Also return the expense row for context
        db.get(`SELECT auto_id, regular, raised_date, due_date FROM expenses WHERE auto_id = ?`, [expense_id], (eErr, expenseRow) => {
          if (eErr) console.error("Error fetching expense row:", eErr);

          console.info("Saved expense_payment:", { expense_id, month_year, savedRow: paymentRow });

          // ---------- OPTIONAL: clear accidental future 'Paid' rows ----------
          // If you want to be strict and ensure no future month is marked Paid accidentally,
          // uncomment the code below. It will reset 'Paid' records for months > month_year.
          //
          // const clearFuturePaidSql = `
          //   UPDATE expense_payments
          //   SET status = 'Pending', paid_amount = NULL, paid_date = NULL
          //   WHERE expense_id = ? AND month_year > ? AND status = 'Paid';
          // `;
          // db.run(clearFuturePaidSql, [expense_id, month_year], (cfErr) => {
          //   if (cfErr) console.error("Error clearing future paid rows:", cfErr);
          // });

          // If you have a salary updater, call it (non-blocking)
          try {
            updateSalaryFromExpense(expense_id, month_year, actual_amount, due_date);
          } catch (uErr) {
            console.error("updateSalaryFromExpense failed:", uErr);
          }

          return res.json({
            message: "Expense payment saved",
            expense_payment: paymentRow || null,
            expense_row: expenseRow || null
          });
        });
      });
    });

  } catch (ex) {
    console.error("Unexpected error in saveExpensePayment:", ex);
    res.status(500).send("Unexpected server error");
  }
});
function updateSalaryFromExpense(expense_id, month_year, actual_amount, due_date) {
  // 1️⃣ Get expense type to find employee
  const findExpense = `
    SELECT type FROM expenses WHERE auto_id = ?
  `;

  db.get(findExpense, [expense_id], (err, exp) => {
    if (err || !exp) {
      return console.error("❌ Expense not found for salary sync.");
    }

    const type = exp.type;

    
    if (!/salary/i.test(type)) {
      return; // not a salary expense
    }

    // Extract name and ID
    const namePart = type.replace(/salary\s*-\s*/i, "").trim();
    const employeeName = namePart.replace(/\([^)]*\)/g, "").trim(); 
    const idMatch = type.match(/\(([^)]+)\)/);                      
    const employee_id = idMatch ? idMatch[1] : null;

    if (!employee_id) {
      return console.error("❌ Could not extract employee_id from:", type);
    }

    // ==========================================================
    // 2️⃣ UPSERT into monthly_salary_payments
    // ==========================================================
    const salarySQL = `
      INSERT INTO monthly_salary_payments (
        employee_id,
        employee_name,
        paid,
        month,
        lop,
        paid_amount,
        actual_to_pay,
        paid_date,
        due_date
      )
      VALUES (?, ?, 'No', ?, 0, 0, ?, NULL, ?)

      ON CONFLICT(employee_id, month)
      DO UPDATE SET
        actual_to_pay = excluded.actual_to_pay,
        due_date = excluded.due_date,
        paid = 'No',
        paid_amount = 0,
        paid_date = NULL;
    `;

    db.run(
      salarySQL,
      [employee_id, employeeName, month_year, actual_amount, due_date],
      (err) => {
        if (err) {
          console.error("❌ Error updating monthly salary:", err);
        } else {
          console.log("✅ Monthly salary updated from expense payment");
        }
      }
    );
  });
  
}
app.post("/upload-employees-excel", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    // Read Excel file
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!sheetData.length) {
      return res.status(400).json({ error: "Excel file is empty" });
    }

    db.serialize(() => {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO employees (
          employee_id,
          employee_name,
          email,
          phone_number,
          skills,
          ctc,
          salary_paid,
          billable,
          consultant_regular,
          active,
          project_ending,
          date_of_joining
        )
        VALUES (?, ?, ?, ?, ?, ?, 'No', ?, ?, ?, ?, ?)
      `);

      sheetData.forEach((row, index) => {
        if (!row.employee_id || !row.employee_name || !row.email) {
          console.warn(`⚠️ Skipping row ${index + 1} (missing required fields)`);
          return;
        }

        stmt.run([
          row.employee_id,
          row.employee_name,
          row.email,
          row.phone_number || null,
          row.skills || "",
          row.ctc || 0,
          row.billable || "No",
          row.consultant_regular || "Regular",
          row.active || "Yes",
          row.project_ending || "No",
          row.date_of_joining || new Date().toISOString().slice(0, 10)
        ]);
      });

      stmt.finalize(() => {
        res.json({
          success: true,
          message: "Employees uploaded successfully",
          totalRows: sheetData.length
        });
      });
    });

  } catch (err) {
    console.error("Excel upload error:", err);
    res.status(500).json({ error: "Failed to process Excel file" });
  }
});
app.post("/upload-clients-excel", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const stmt = db.prepare(`
      INSERT INTO ClientsTable (
        clientName,
        aboutClient,
        paymentTerms,
        location,
        contactSpoc,
        contactEmail,
        contactNumber,
        gstApplicable,
        gstNumber,
        gstPercentage
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    rows.forEach((row) => {
      // minimal validation
      if (!row.clientName || !row.contactEmail) return;

      stmt.run([
        row.clientName,
        row.aboutClient || "",
        row.paymentTerms || "",
        row.location || "",
        row.contactSpoc || "",
        row.contactEmail,
        row.contactNumber || "",
        row.gstApplicable || "No",
        row.gstNumber || "",
        row.gstPercentage || "",
      ]);
    });

    stmt.finalize(() => {
      res.json({
        success: true,
        message: "Clients imported successfully",
      });
    });
  } catch (err) {
    console.error("Excel upload error:", err);
    res.status(500).json({ error: err.message });
  }
});


app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});