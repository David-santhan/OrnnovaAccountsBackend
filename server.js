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
app.use(cors({ origin: "http://localhost:3001", credentials: true }));
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


// SQLite DB

const db = new sqlite3.Database("./Accounting.db", (err) => {
  if (err) return console.error(err.message);
  console.log("Connected to SQLite database.");

  db.run("PRAGMA journal_mode=WAL;");      // enable WAL
  db.configure("busyTimeout", 5000);       // wait 5 seconds if busy
});
app.locals.db = db;

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
    employee_id TEXT UNIQUE NOT NULL,
    employee_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone_number INTEGER,
    skills TEXT,
    resume TEXT,
    photo TEXT,
    ctc TEXT,
    salary_paid TEXT CHECK(salary_paid IN ('Yes','No')),
     ctc_effective_from TEXT DEFAULT (strftime('%Y-%m', 'now')), -- ✅ new
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

    FOREIGN KEY(employee_id) REFERENCES employees(employee_id)
);
`
)



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


db.run(`
CREATE TABLE IF NOT EXISTS salary_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL,
  old_ctc REAL,
  new_ctc REAL,
  effective_month TEXT NOT NULL,   -- YYYY-MM
  changed_at TEXT DEFAULT (datetime('now')),
  remarks TEXT,
  FOREIGN KEY(employee_id) REFERENCES employees(employee_id)
);
`);





// setTimeout(() => {
//   db.run("DROP TABLE IF EXISTS transactions;", (err) => {
//     if (err) {
//       console.error("Error dropping table:", err);
//     } else {
//       console.log("✅ Transactions table dropped successfully.");
//     }
//   });
// }, 1000);


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

  // const query = `
  //   INSERT INTO Clients
  //   (clientName, aboutClient, paymentTerms, location, contactSpoc, contactEmail, contactNumber, gstApplicable, gstNumber, gstPercentage)
  //   VALUES ( ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  // `;

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
    gst,tds,netPayable,
    employees, // ✅ from frontend as JSON
    hoursOrDays,
    poNumber,
    purchaseOrderValue,
    active,
    invoiceCycle,
  } = req.body;

  const purchaseOrderFile = req.file ? req.file.filename : null;

  getUniqueProjectID(db, clientID, projectName, (err, uniqueID) => {
    if (err) {
      console.error("Error generating projectID:", err);
      return res.status(500).json({ error: "Failed to generate project ID" });
    }

    let employeesData = [];
    try {
      employeesData = typeof employees === "string" ? JSON.parse(employees) : employees;
    } catch (e) {
      console.error("Error parsing employees JSON:", e);
    }

    const query = `
      INSERT INTO Projects (
        projectID, clientID, startDate, endDate, projectName, projectDescription,
        skill, projectLocation, spoc, mailID, mobileNo, billingType, billRate,
        monthlyBilling,gst,tds,netPayable, employees,hoursOrDays, poNumber, purchaseOrder, purchaseOrderValue,
        active, invoiceCycle
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?,?)
    `;

    db.run(
      query,
      [
        uniqueID,
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
        gst,tds,netPayable,
        JSON.stringify(employeesData), // ✅ store JSON
        hoursOrDays,
        poNumber,
        purchaseOrderFile,
        purchaseOrderValue,
        active,
        invoiceCycle,
      ],
      function (err) {
        if (err) {
          console.error("DB Error:", err.message);
          return res.status(500).json({ error: err.message });
        }

        res.json({ projectID: uniqueID, message: "Project added successfully" });
      }
    );
  });
});


// -------- GET PROJECTS API --------
// app.get("/getprojects", (req, res) => {
//   // 1️⃣ Fetch all projects
//   db.all("SELECT * FROM Projects", [], (err, projects) => {
//     if (err) return res.status(500).json({ error: err.message });

//     db.all("SELECT employee_id, employee_name FROM employees", [], (err, emps) => {
//       if (err) return res.status(500).json({ error: err.message });

//       const map = new Map(emps.map(e => [e.employee_id, e.employee_name]));
//       const formatted = rows.map(row => {
//         let parsed = [];
//         try {
//           const arr = JSON.parse(row.employees || "[]");
//           parsed = arr.map(emp => ({
//             id: typeof emp === "string" ? emp : emp.id,
//             name: typeof emp === "string" ? map.get(emp) : emp.name,
//           }));
//         } catch {
//           parsed = [];
//         }
//         return { ...row, employees: parsed };
//       });

//       res.json(formatted);
//     });
//   });
// });

app.get("/getprojects", (req, res) => {
  // 1️⃣ Fetch all projects
  db.all("SELECT * FROM Projects", [], (err, projects) => {
    if (err) return res.status(500).json({ error: err.message });

    // 2️⃣ Fetch all employees
    db.all("SELECT employee_id, employee_name FROM employees", [], (err, emps) => {
      if (err) return res.status(500).json({ error: err.message });

      // 3️⃣ Map employee IDs to names for lookup
      const empMap = new Map(emps.map(e => [e.employee_id, e.employee_name]));

      // 4️⃣ Format each project’s employees
      const formatted = projects.map(project => {
        let parsed = [];
        try {
          const arr = JSON.parse(project.employees || "[]");
          parsed = arr.map(emp => ({
            id: typeof emp === "string" ? emp : emp.id,
            name: typeof emp === "string" ? empMap.get(emp) : emp.name,
          }));
        } catch {
          parsed = [];
        }
        return { ...project, employees: parsed };
      });

      // 5️⃣ Send final response
      res.json(formatted);
    });
  });
});


// POST API (add new employee)
app.post(
  "/postemployees",
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

// ✅ POST add salary
// app.post("/addsalaries", (req, res) => {
//   const {
//     employee_id,
//     employee_name,
//     month,
//     paid,
//     paid_date,

//     basic_pay,
//     hra,
//     conveyance_allowance,
//     medical_allowance,
//     lta,
//     personal_allowance,
//     gross_salary,
//     ctc,

//     professional_tax,
//     insurance,
//     pf,
//     tds,

//     employer_pf,
//     employer_health_insurance,

//     net_takehome,
//   } = req.body;

//   const query = `
//     INSERT INTO salary_payments (
//       employee_id, employee_name, month, paid, paid_date,
//       basic_pay, hra, conveyance_allowance, medical_allowance,
//       lta, personal_allowance, gross_salary, ctc,
//       professional_tax, insurance, pf, tds,
//       employer_pf, employer_health_insurance, net_takehome
//     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//   `;

//   db.run(
//     query,
//     [
//       employee_id,
//       employee_name,
//       month,
//       paid || "No",
//       paid_date || null,
//       basic_pay || 0,
//       hra || 0,
//       conveyance_allowance || 0,
//       medical_allowance || 0,
//       lta || 0,
//       personal_allowance || 0,
//       gross_salary || 0,
//       ctc || 0,
//       professional_tax || 0,
//       insurance || 0,
//       pf || 0,
//       tds || 0,
//       employer_pf || 0,
//       employer_health_insurance || 0,
//       net_takehome || 0,
//     ],
//     function (err) {
//       if (err) {
//         console.error("❌ Salary Insert Error:", err.message);
//         return res.status(500).json({ error: err.message });
//       }
//       res.json({ id: this.lastID, message: "Salary record added successfully" });
//     }
//   );
// });

app.post("/addsalaries", (req, res) => {
  console.log("📩 Incoming salary data:", req.body);

  const query = `
    INSERT INTO salary_payments (
      employee_id, employee_name, month, paid, paid_date,
      basic_pay, hra, conveyance_allowance, medical_allowance,
      lta, personal_allowance, gross_salary, ctc,
      professional_tax, insurance, pf, tds,
      employer_pf, employer_health_insurance, net_takehome
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    query,
    [
      req.body.employee_id,
      req.body.employee_name,
      req.body.month,
      req.body.paid || "No",
      req.body.paid_date || null,
      req.body.basic_pay || 0,
      req.body.hra || 0,
      req.body.conveyance_allowance || 0,
      req.body.medical_allowance || 0,
      req.body.lta || 0,
      req.body.personal_allowance || 0,
      req.body.gross_salary || 0,
      req.body.ctc || 0,
      req.body.professional_tax || 0,
      req.body.insurance || 0,
      req.body.pf || 0,
      req.body.tds || 0,
      req.body.employer_pf || 0,
      req.body.employer_health_insurance || 0,
      req.body.net_takehome || 0,
    ],
    function (err) {
      if (err) {
        console.error("❌ Salary Insert Error:", err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, message: "Salary record added successfully" });
    }
  );
});


// GET AVailable Employees For Salaries
app.get("/getAvailableEmployeesForSalaries", (req, res) => {
  const sql = `
    SELECT employee_id, employee_name,ctc
    FROM employees
    WHERE employee_id NOT IN (
      SELECT employee_id FROM salary_payments WHERE employee_id IS NOT NULL
    )
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows); // 👈 ensures it's an array
  });
});



//here onwords forecastion..........................................



// // Post Forecast
// app.post("/forecasts", (req, res) => {
//   const { name, start_date, end_date } = req.body;

//   if (!name || !start_date || !end_date) {
//     return res.status(400).json({ error: "All fields are required" });
//   }

//   db.run(
//     `INSERT INTO forecasts (name, start_date, end_date) VALUES (?, ?, ?)`,
//     [name, start_date, end_date],
//     function (err) {
//       if (err) return res.status(500).json({ error: err.message });
//       res.json({ success: true, forecast_id: this.lastID });
//     }
//   );
// });

// // Get Forcasts
// app.get("/forecasts", (req, res) => {
//   db.all(`SELECT * FROM forecasts`, [], (err, rows) => {
//     if (err) return res.status(500).json({ error: err.message });
//     res.json({ forecasts: rows });
//   });
// });

// // Update forcast End Date
// app.put("/forecasts/:id", (req, res) => {
//   const { id } = req.params;
//   const { end_date } = req.body;

//   if (!end_date) return res.status(400).json({ error: "End date is required" });

//   db.run(
//     `UPDATE forecasts SET end_date = ? WHERE id = ?`,
//     [end_date, id],
//     function (err) {
//       if (err) return res.status(500).json({ error: err.message });
//       if (this.changes === 0)
//         return res.status(404).json({ error: "Forecast not found" });

//       res.json({ success: true, message: "End date updated successfully" });
//     }
//   );
// });

// // POST /transactions
// app.post("/transactions", (req, res) => {
//   const { forecast_id, name, type, amount, start_date, end_date, category } = req.body;

//   if (!forecast_id || !name || !type || !amount || !start_date) {
//     return res.status(400).json({ error: "Missing required fields" });
//   }

//   db.get("SELECT end_date FROM forecasts WHERE id = ?", [forecast_id], (err, forecast) => {
//     if (err) {
//       console.error("DB Error:", err);
//       return res.status(500).json({ error: err.message });
//     }

//     if (!forecast) {
//       console.error("Forecast not found for id:", forecast_id);
//       return res.status(404).json({ error: "Forecast not found" });
//     }

//     const finalEndDate = end_date || forecast.end_date;

//     db.run(
//       `INSERT INTO forecast_transactions (forecast_id, name, type, amount, start_date, end_date, category)
//        VALUES (?, ?, ?, ?, ?, ?, ?)`,
//       [forecast_id, name, type, amount, start_date, finalEndDate, category || null],
//       function (err) {
//         if (err) {
//           console.error("Insert Error:", err);
//           return res.status(500).json({ error: err.message });
//         }
//         res.json({ success: true, transactionId: this.lastID });
//       }
//     );
//   });
// });

// // Getting Particular Forcast Transactions
// app.get("/transactions/:forecastId", (req, res) => {
//   const forecastId = req.params.forecastId;

//   const query = "SELECT * FROM forecast_transactions WHERE forecast_id = ?";

//   db.all(query, [forecastId], (err, rows) => {
//     if (err) {
//       console.error("Fetch Error:", err);
//       return res.status(500).json({ error: err.message });
//     }
//     res.json({ transactions: rows });
//   });
// });

// Post Invoices
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
    received,
    received_date
  } = req.body;

  // First, get client's paymentTerms from ClientsTable
  db.get(
    "SELECT paymentTerms FROM ClientsTable WHERE clientName = ?",
    [client_name],
    (err, client) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error fetching client data" });
      }

      if (!client) {
        return res.status(400).json({ error: "Client not found" });
      }

      const paymentTerms = client.paymentTerms || 0;

      // Calculate due_date if not provided
      let finalDueDate = due_date;
      if (!finalDueDate || finalDueDate.trim() === "") {
        const d = new Date(invoice_date);
        d.setDate(d.getDate() + paymentTerms + 2); // as per your logic
        finalDueDate = d.toISOString().split("T")[0];
      }

      // Insert invoice
      const sql = `
        INSERT INTO invoices (
          invoice_number, invoice_date, client_name, project_id,
          start_date, end_date, invoice_cycle, invoice_value,
          gst_amount, due_date, billable_days, received, received_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          invoice_cycle,
          invoice_value,
          gst_amount,
          finalDueDate,
          billable_days,
          received || "No",
          received_date || null
        ],
        function (err) {
          if (err) {
            console.error("Insert error:", err);
            return res.status(500).json({ error: err.message });
          }
          res.json({ success: true, id: this.lastID });
        }
      );
    }
  );
});

// Get Invoices
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


// GET Project by ID
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
    res.json(row);
  });
});

// API to fetch active projects
app.get("/getactive-projects", (req, res) => {
  const { filterMonthYear } = req.query; // e.g., "2025-09"

  // Default to current month if not provided
  const today = new Date();
  const yearMonth =
    filterMonthYear ||
    `${today.getFullYear()}-${(today.getMonth() + 1)
      .toString()
      .padStart(2, "0")}`;

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
    res.json(rows);
    console.log(rows);
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

// Update Project by ID
app.put("/update-project/:id", upload.single("purchaseOrder"), (req, res) => {
  const { id } = req.params;
  const data = req.body;
  const file = req.file ? req.file.filename : null;

  // ✅ Handle employees JSON array safely
  let employeesData = [];
  try {
    employeesData = typeof data.employees === "string"
      ? JSON.parse(data.employees)
      : data.employees;
  } catch (err) {
    console.error("Error parsing employees JSON:", err);
  }

  // ✅ Base SQL (purchaseOrder condition handled below)
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
      invoiceCycle = ?
  `;

  // ✅ Add purchaseOrder if file uploaded
  if (file) sql += `, purchaseOrder = ?`;

  sql += ` WHERE projectID = ?`;

  // ✅ Prepare parameters
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
    JSON.stringify(employeesData || []), // ✅ Store employees as JSON
    data.hoursOrDays,
    data.poNumber,
    data.purchaseOrderValue,
    data.active,
    data.invoiceCycle,
  ];

  if (file) params.push(file);
  params.push(id);

  // ✅ Execute update query
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
// app.put("/employees/:id", upload.fields([
//   { name: "resume", maxCount: 1 },
//   { name: "photo", maxCount: 1 }
// ]), (req, res) => {
//   const employeeId = req.params.id;

//   const {
//     employee_id,
//     employee_name,
//     email,
//     phone_number,
//     skills,
//     salary_paid,
//     billable,
//     consultant_regular,
//     active,
//     ctc,
//     project_ending,
//     date_of_joining,
//   } = req.body;

//   // Ensure uploaded files are stored with "uploads/" path
//   const resume = req.files?.resume ? `uploads/${req.files.resume[0].filename}` : null;
//   const photo  = req.files?.photo  ? `uploads/${req.files.photo[0].filename}`  : null;

//   const fields = [
//     { key: "employee_id", value: employee_id },
//     { key: "employee_name", value: employee_name },
//     { key: "email", value: email },
//     { key: "phone_number", value: phone_number },
//     { key: "skills", value: skills },
//     { key: "salary_paid", value: salary_paid },
//     { key: "billable", value: billable },
//     { key: "consultant_regular", value: consultant_regular },
//     { key: "active", value: active },
//     { key: "project_ending", value: project_ending },
//     { key: "ctc", value: ctc },
//     { key: "resume", value: resume },
//     { key: "photo", value: photo },
//     { key: "date_of_joining", value: date_of_joining },
//   ].filter(f => f.value !== null && f.value !== undefined);

//   const setClause = fields.map(f => `${f.key} = ?`).join(", ");
//   const values = fields.map(f => f.value);
//   values.push(employeeId); // for WHERE clause

//   const sql = `UPDATE employees SET ${setClause} WHERE id = ?`;

//   db.run(sql, values, function(err) {
//     if (err) {
//       console.error(err);
//       return res.status(500).json({ error: err.message });
//     }
//     res.json({ success: true, changes: this.changes });
//   });
// });
// Helper to compute YYYY-MM for JS
// ✅ Helper: current month in YYYY-MM
function currentMonthKey(offsetMonths = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  return d.toISOString().slice(0, 7); // "YYYY-MM"
}

// ✅ Update Employee + Salary logic
app.put(
  "/employees/:id",
  upload.fields([
    { name: "resume", maxCount: 1 },
    { name: "photo", maxCount: 1 },
  ]),
  (req, res) => {
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
      ctc, // New CTC
      project_ending,
      date_of_joining,
      effective_month, // Optional: custom effective month (YYYY-MM)
    } = req.body;

    const resume = req.files?.resume
      ? `uploads/${req.files.resume[0].filename}`
      : null;
    const photo = req.files?.photo
      ? `uploads/${req.files.photo[0].filename}`
      : null;

    // Collect only non-null fields
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
    ].filter((f) => f.value !== null && f.value !== undefined);

    if (fields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const setClause = fields.map((f) => `${f.key} = ?`).join(", ");
    const values = fields.map((f) => f.value);
    values.push(employeeId);

    const sql = `UPDATE employees SET ${setClause} WHERE id = ?`;

    // Step 1️⃣: Fetch current employee (for old CTC)
    db.get("SELECT * FROM employees WHERE id = ?", [employeeId], (err, existing) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!existing) return res.status(404).json({ error: "Employee not found" });

      const oldCtc = Number(existing.ctc || 0);
      const newCtc = ctc !== undefined && ctc !== null ? Number(ctc) : oldCtc;

      // Step 2️⃣: Update employee info
      db.run(sql, values, function (err2) {
        if (err2) {
          console.error("Error updating employee:", err2.message);
          return res.status(500).json({ error: err2.message });
        }

        // Step 3️⃣: If CTC changed, record it and update salaries
        if (!isNaN(newCtc) && newCtc !== oldCtc) {
          const effMonth =
            (effective_month && String(effective_month).slice(0, 7)) ||
            currentMonthKey();

          // Insert into salary_history
          db.run(
            `INSERT INTO salary_history (employee_id, old_ctc, new_ctc, effective_month, remarks)
             VALUES (?, ?, ?, ?, ?)`,
            [existing.employee_id, oldCtc, newCtc, effMonth, "CTC updated via API"],
            function (err3) {
              if (err3) console.error("Error inserting salary_history:", err3.message);

              // Step 4️⃣: Get latest effective month from history
              db.get(
                `SELECT effective_month
                 FROM salary_history
                 WHERE employee_id = ?
                 ORDER BY CAST(REPLACE(effective_month, '-', '') AS INTEGER) DESC
                 LIMIT 1`,
                [existing.employee_id],
                (err5, row) => {
                  if (err5)
                    return res.status(500).json({
                      error: "Error fetching latest salary history: " + err5.message,
                    });

                  const effectiveFrom = row ? row.effective_month : effMonth;

                  // Step 5️⃣: Update salary structure only for effectiveFrom onward
                  const sqlUpdate = `
                    UPDATE salary_payments
                    SET
                      ctc = ?,
                      gross_salary = ROUND(? / 12.0, 2),
                      basic_pay = ROUND((? / 12.0) * 0.40, 2),
                      hra = ROUND((? / 12.0) * 0.20, 2),
                      conveyance_allowance = ROUND((? / 12.0) * 0.05, 2),
                      medical_allowance = ROUND((? / 12.0) * 0.05, 2),
                      lta = ROUND((? / 12.0) * 0.05, 2),
                      personal_allowance = ROUND((? / 12.0) * 0.25, 2),
                      pf = ROUND((? / 12.0) * 0.12, 2),
                      professional_tax = ROUND((? / 12.0) * 0.02, 2),
                      insurance = ROUND((? / 12.0) * 0.01, 2),
                      tds = ROUND((? / 12.0) * 0.05, 2),
                      employer_pf = ROUND((? / 12.0) * 0.12, 2),
                      employer_health_insurance = ROUND((? / 12.0) * 0.01, 2),
                      net_takehome = ROUND(
                        (
                          (? / 12.0) -
                          (
                            (? / 12.0) * 0.12 +
                            (? / 12.0) * 0.02 +
                            (? / 12.0) * 0.01 +
                            (? / 12.0) * 0.05
                          )
                        ), 2
                      )
                    WHERE employee_id = ?
                      AND CAST(REPLACE(month, '-', '') AS INTEGER) >= CAST(REPLACE(?, '-', '') AS INTEGER)
                  `;

                  const params = [
                    newCtc, newCtc, newCtc, newCtc, newCtc, newCtc, newCtc, newCtc,
                    newCtc, newCtc, newCtc, newCtc, newCtc, newCtc,
                    newCtc, newCtc, newCtc, newCtc, newCtc,
                    existing.employee_id,
                    effectiveFrom,
                  ];

                  db.run(sqlUpdate, params, function (err4) {
                    if (err4) {
                      console.error("Error updating salary_payments:", err4.message);
                      return res.status(500).json({
                        message:
                          "Employee updated but salary_payments update failed",
                        error: err4.message,
                      });
                    }

                    return res.json({
                      message: `✅ Employee updated and salary structure updated from ${effectiveFrom}`,
                      updatedRows: this.changes,
                    });
                  });
                }
              );
            }
          );
        } else {
          // No CTC change
          return res.json({ success: true, changes: this.changes });
        }
      });
    });
  }
);




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

  // Validate input
  if (!["Yes", "No"].includes(received)) {
    return res.status(400).json({ error: "Received must be 'Yes' or 'No'" });
  }

  // If received = No, clear received_date
  const updatedDate = received === "Yes" ? received_date || null : null;

  const updateInvoiceQuery = `
    UPDATE invoices
    SET received = ?, received_date = ?
    WHERE id = ?
  `;

  // Step 1️⃣: Update the invoice
  db.run(updateInvoiceQuery, [received, updatedDate, id], function (err) {
    if (err) {
      console.error("❌ Error updating invoice:", err);
      return res.status(500).json({ error: "Failed to update invoice" });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    console.log(`✅ Invoice ${id} updated with received=${received}, date=${updatedDate}`);

    // Step 2️⃣: Fetch the updated invoice
    db.get("SELECT * FROM invoices WHERE id = ?", [id], (err, invoice) => {
      if (err) {
        console.error("❌ Error fetching updated invoice:", err);
        return res.status(500).json({ error: "Failed to fetch updated invoice" });
      }

      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found after update" });
      }

      // Step 3️⃣: Fetch Current Account
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

          // Step 4️⃣: Prepare Transaction Details
          const invoiceNumber = invoice.invoice_number;
          const amount = invoice.invoice_value;
          const accountNumber = account.account_number;
          const previousBalance = account.balance;
          let updatedBalance, type, description, transactionId;

          if (received === "Yes") {
            transactionId = `CRD|${invoiceNumber}`;
            type = "Credit";
            description = `Amount received for invoice ${invoiceNumber}`;
            updatedBalance = previousBalance + amount;
          } else {
            transactionId = `DED|${invoiceNumber}`;
            type = "Debit";
            description = `Amount reversed for invoice ${invoiceNumber}`;
            updatedBalance = previousBalance - amount;
          }

          // Step 5️⃣: Insert Transaction with balance tracking
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
                console.log(`✅ Transaction inserted: ${transactionId}`);
              }

              // Step 6️⃣: Update Account Balance
              db.run(
                "UPDATE accounts SET balance = ? WHERE account_number = ?",
                [updatedBalance, accountNumber],
                (err) => {
                  if (err) {
                    console.error("❌ Error updating account balance:", err);
                    return res.status(500).json({ error: "Failed to update account balance" });
                  }

                  console.log(
                    `💰 Account ${accountNumber} balance updated: Old=${previousBalance}, New=${updatedBalance}`
                  );

                  // Step 7️⃣: Send Response
                  res.json({
                    message:
                      received === "Yes"
                        ? "Invoice marked as received, transaction recorded, and balance updated"
                        : "Invoice marked as not received, reversal transaction recorded, and balance updated",
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






app.post("/monthlySalary/save", (req, res) => {
  const { empId, empName, paid, month, lop, paidAmount, actualToPay } = req.body;

  if (!empId || !empName || !month) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  // 1️⃣ Save salary record
  db.run(
    `
    INSERT INTO monthly_salary_payments 
    (employee_id, employee_name, paid, month, lop, paid_amount, actual_to_pay)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [empId, empName, paid, month, lop, paidAmount, actualToPay],
    function (err) {
      if (err) {
        console.error("Error saving salary:", err);
        return res.status(500).json({ success: false, message: "Database error" });
      }

      const salaryId = this.lastID;

      // ✅ Proceed only if paid = "Yes"
      if (paid === "Yes" && paidAmount > 0) {
        db.get(`SELECT * FROM accounts WHERE account_type = 'Current'`, (err, currentAcc) => {
          if (err || !currentAcc) {
            console.error("Error finding current account:", err);
            return res.status(500).json({ success: false, message: "Current account not found" });
          }

          const currentBalance = currentAcc.balance;

          // ✅ If Current Account has enough balance
          if (currentBalance >= paidAmount) {
            const newBalance = currentBalance - paidAmount;

            // 💳 Deduct from Current Account
            db.run(
              `UPDATE accounts SET balance = ? WHERE account_id = ?`,
              [newBalance, currentAcc.account_id],
              (err) => {
                if (err) {
                  console.error("Error updating current account:", err);
                  return res.status(500).json({ success: false, message: "Balance update failed" });
                }

                // 💾 Generate transaction details
                const transactionId = `DEB/SAL/${empId}/${month}`;
                const description = `Salary for Employee ${empId} for the month of ${month}`;
                const previousBalance = currentBalance;
                const updatedBalance = newBalance;

                // 💾 Record transaction with balance tracking
                db.run(
                  `
                  INSERT INTO transactions 
                  (transaction_id, account_number, type, description, amount, previous_balance, updated_balance)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                  `,
                  [
                    transactionId,
                    currentAcc.account_number,
                    "Debit",
                    description,
                    paidAmount,
                    previousBalance,
                    updatedBalance,
                  ],
                  (err) => {
                    if (err) {
                      console.error("Error inserting transaction:", err);
                      return res.status(500).json({ success: false, message: "Transaction failed" });
                    }

                    return res.json({
                      success: true,
                      message: "Salary paid and transaction recorded successfully",
                      transaction: {
                        transaction_id: transactionId,
                        type: "Debit",
                        amount: paidAmount,
                        description,
                        previous_balance: previousBalance,
                        updated_balance: updatedBalance,
                        account_number: currentAcc.account_number,
                      },
                    });
                  }
                );
              }
            );
          } else {
            // ⚠️ If insufficient, transfer from Capital
            const needed = paidAmount - currentBalance;

            db.get(`SELECT * FROM accounts WHERE account_type = 'Capital'`, (err, capitalAcc) => {
              if (err || !capitalAcc) {
                console.error("Capital account missing:", err);
                return res.status(500).json({ success: false, message: "Capital account not found" });
              }

              if (capitalAcc.balance < needed) {
                return res.status(400).json({
                  success: false,
                  message: "Insufficient funds in both accounts",
                });
              }

              const capitalPrevBalance = capitalAcc.balance;
              const capitalNewBalance = capitalPrevBalance - needed;
              const currentPrevBalance = currentAcc.balance;
              const currentNewBalance = currentPrevBalance + needed - paidAmount;

              // 🔁 Update both balances
              db.run(`UPDATE accounts SET balance = ? WHERE account_id = ?`, [capitalNewBalance, capitalAcc.account_id]);
              db.run(`UPDATE accounts SET balance = ? WHERE account_id = ?`, [currentNewBalance, currentAcc.account_id]);

              // 💾 Log transfer transaction (Capital → Current)
              const transferId = `TRF/SAL/${empId}/${month}`;
              const transferDesc = `Transfer ₹${needed} from Capital → Current for salary payment`;

              db.run(
                `
                INSERT INTO transactions 
                (transaction_id, account_number, type, description, amount, previous_balance, updated_balance)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
                [
                  transferId,
                  capitalAcc.account_number,
                  "Transfer",
                  transferDesc,
                  needed,
                  capitalPrevBalance,
                  capitalNewBalance,
                ]
              );

              // 💾 Log salary debit from Current Account
              const salaryTransactionId = `DEB/SAL/${empId}/${month}`;
              const salaryDesc = `Salary for Employee ${empId} for the month of ${month}`;

              db.run(
                `
                INSERT INTO transactions 
                (transaction_id, account_number, type, description, amount, previous_balance, updated_balance)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
                [
                  salaryTransactionId,
                  currentAcc.account_number,
                  "Debit",
                  salaryDesc,
                  paidAmount,
                  currentPrevBalance + needed,
                  currentNewBalance,
                ]
              );

              return res.json({
                success: true,
                message: `Salary paid successfully after transferring ₹${needed} from Capital to Current.`,
                transactions: [
                  {
                    transaction_id: transferId,
                    type: "Transfer",
                    amount: needed,
                    description: transferDesc,
                    previous_balance: capitalPrevBalance,
                    updated_balance: capitalNewBalance,
                    account_number: capitalAcc.account_number,
                  },
                  {
                    transaction_id: salaryTransactionId,
                    type: "Debit",
                    amount: paidAmount,
                    description: salaryDesc,
                    previous_balance: currentPrevBalance + needed,
                    updated_balance: currentNewBalance,
                    account_number: currentAcc.account_number,
                  },
                ],
              });
            });
          }
        });
      } else {
        // Not paid yet
        return res.json({ success: true, message: "Salary saved (not paid yet)" });
      }
    }
  );
});


// ✅ Pay Expense and Record Transaction
// ✅ Pay Expense and Record Transaction (with account deduction)
app.post("/pay-expense", (req, res) => {
  const { expense_id, paid_amount, paid_date } = req.body;
   
  if (!expense_id || !paid_amount || !paid_date) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  const amount = parseFloat(paid_amount);
  const paidMonthYear = new Date(paid_date).toLocaleString("default", {
    month: "short",
    year: "numeric",
  });

  // ⏰ Generate 4-digit time code (HHMM)
  const now = new Date();
  const timeCode = `${now.getHours().toString().padStart(2, "0")}${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;

  // 1️⃣ Get Expense details
  db.get(`SELECT * FROM expenses WHERE auto_id = ?`, [expense_id], (err, expense) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });

    const expenseType = expense.type || expense.description || "General";
    const isRegular = expense.regular === "Yes" ? "Regular" : "NonReg";
    const transactionId = `DEB|${isRegular}|${expenseType}|${paidMonthYear}|${timeCode}`;
    const description = `Expense paid for ${expenseType} of month ${paidMonthYear}`;

    // 2️⃣ Get Current Account
    db.get(`SELECT * FROM accounts WHERE account_type = 'Current'`, (err, currentAcc) => {
      if (err || !currentAcc) {
        return res.status(500).json({ success: false, message: "Current account not found" });
      }

      // ❌ If insufficient balance
      if (currentAcc.balance < amount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient funds. Current balance: ₹${currentAcc.balance.toLocaleString()} — required: ₹${amount.toLocaleString()}`,
        });
      }

      // ✅ Enough balance → proceed with payment
      const prevBalance = currentAcc.balance;
      const newBalance = prevBalance - amount;

      db.serialize(() => {
        // 💰 Update Current Account
        db.run(`UPDATE accounts SET balance = ? WHERE account_id = ?`, [newBalance, currentAcc.account_id]);

        // 📒 Record Transaction (Debit)
        db.run(
          `
          INSERT INTO transactions 
            (transaction_id, account_number, type, amount, description, previous_balance, updated_balance, created_at)
          VALUES (?, ?, 'Debit', ?, ?, ?, ?, datetime('now'))
          `,
          [transactionId, currentAcc.account_number, amount, description, prevBalance, newBalance]
        );

        // 🧾 Insert or Update expense_payments
        db.run(
          `
          INSERT INTO expense_payments (expense_id, month_year, actual_amount, paid_amount, paid_date, status)
          VALUES (?, ?, ?, ?, ?, 'Paid')
          ON CONFLICT(expense_id, month_year)
          DO UPDATE SET 
            paid_amount = excluded.paid_amount,
            paid_date = excluded.paid_date,
            status = 'Paid';
          `,
          [expense_id, paidMonthYear, expense.amount || amount, amount, paid_date]
        );

        return res.json({
          success: true,
          message: `Expense paid successfully. ₹${amount} debited from Current Account.`,
          transaction_id: transactionId,
          previous_balance: prevBalance,
          updated_balance: newBalance,
        });
      });
    });
  });
});



// Get monthly salary by month
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

// GET all expenses
// app.get("/getexpenses", (req, res) => {
//   db.all("SELECT * FROM expenses ORDER BY auto_id DESC", [], (err, rows) => {
//     if (err) {
//       console.error("DB Query Error:", err.message);
//       return res.status(500).json({ error: err.message });
//     }

//     const formatted = rows.map(row => ({
//       id: `E${row.auto_id}`,
//       regular: row.regular,
//       type: row.type,
//       description: row.description,
//       amount: row.amount,
//       currency: row.currency,
//       raised_date: row.raised_date,
//       paid_date: row.paid_date,
//       due_date: row.due_date,
//       paid_amount: row.paid_amount,
//       status:row.status
//     }));
//     // console.log("Expenses fetched:", formatted.length);
//     res.json(formatted);
//   });
// });

app.get("/getexpenses", (req, res) => {
  const { month } = req.query; // format: "YYYY-MM"
  if (!month) return res.status(400).json({ error: "Month is required (YYYY-MM)" });

  const selectedYear = parseInt(month.split("-")[0]);
  const selectedMonth = parseInt(month.split("-")[1]);

  // 🗓️ Convert "YYYY-MM" → "Nov 2025"
  const date = new Date(`${month}-01`);
  const formattedMonth = date.toLocaleString("default", { month: "short", year: "numeric" });

  const sql = `
    SELECT 
      e.auto_id,
      e.regular,
      e.type,
      e.description,
      e.amount,
      e.currency,
      e.raised_date,
      e.due_date,
      e.status AS expense_status,
      ep.paid_amount,
      ep.paid_date,
      ep.status AS payment_status
    FROM expenses e
    LEFT JOIN expense_payments ep
      ON e.auto_id = ep.expense_id AND ep.month_year = ?
    ORDER BY e.auto_id DESC
  `;

  db.all(sql, [formattedMonth], (err, rows) => {
    if (err) {
      console.error("DB Query Error:", err.message);
      return res.status(500).json({ error: err.message });
    }

    const filtered = rows.filter(row => {
      const raised = new Date(row.raised_date);
      const raisedYear = raised.getFullYear();
      const raisedMonth = raised.getMonth() + 1;

      if (row.regular === "Yes") {
        return (
          selectedYear > raisedYear ||
          (selectedYear === raisedYear && selectedMonth >= raisedMonth)
        );
      } else {
        return selectedYear === raisedYear && selectedMonth === raisedMonth;
      }
    });

    const formatted = filtered.map(row => ({
      id: `E${row.auto_id}`,
      regular: row.regular,
      type: row.type,
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      raised_date: row.raised_date,
      due_date: row.due_date,
      paid_amount: row.paid_amount || 0,
      paid_date: row.paid_date || "Not Paid",
      paymentstatus: row.payment_status || "Pending",
      expensestatus: row.expense_status || "Raised",
    }));

    res.json(formatted);
    console.log(formatted);
  });
});


// POST expense
app.post("/postexpenses", (req, res) => {
  const { regular, type, description, amount, currency, raised_date, due_date, paid_date, paid_amount, status } = req.body;

  // Validate required fields
  if (!regular || !type || !amount || !raised_date || !due_date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const query = `
    INSERT INTO expenses (regular, type, description, amount, currency, raised_date, due_date, paid_date, paid_amount, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    regular,
    type,
    description || "",
    amount,
    currency || "INR",
    raised_date,
    due_date,
    paid_date || "00-00-0000",
    paid_amount || 0,
    status || "Raised"
  ];

  db.run(query, params, function(err) {
    if (err) {
      console.error("DB Insert Error:", err.message);
      return res.status(500).json({ error: err.message });
    }

    res.json({
      id: `E${this.lastID}`,
      regular,
      type,
      description: description || "",
      amount,
      currency: currency || "INR",
      raised_date,
      due_date,
      paid_date: paid_date || "00-00-0000",
      paid_amount: paid_amount || 0,
      status: status || "Raised"
    });
  });
});

// API: Mark expense as paid
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


// 🔹 Create Account
app.post("/accounts", (req, res) => {
  const { account_number, account_name, account_type, balance } = req.body;
  db.run(
    `INSERT INTO accounts (account_number, account_name, account_type, balance)
     VALUES (?, ?, ?, ?)`,
    [account_number, account_name, account_type, balance || 0],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ id: this.lastID, message: "Account created" });
    }
  );
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




// 🔹 Create Account
app.post("/accounts", (req, res) => {
  const { account_number, account_name, account_type, balance } = req.body;
  db.run(
    `INSERT INTO accounts (account_number, account_name, account_type, balance)
     VALUES (?, ?, ?, ?)`,
    [account_number, account_name, account_type, balance || 0],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ id: this.lastID, message: "Account created" });
    }
  );
});

// 🔹 Get All Accounts
app.get("/accounts", (req, res) => {
  db.all(`SELECT * FROM accounts`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 🔹 Hide / Unhide Account
app.patch("/accounts/:id/hide", (req, res) => {
  const { hide } = req.body;
  db.run(`UPDATE accounts SET is_hidden = ? WHERE account_id = ?`, [hide, req.params.id], (err) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ message: hide ? "Hidden" : "Visible" });
  });
});

// 🔹 Get Account Balance
app.get("/accounts/:number/balance", (req, res) => {
  db.get(`SELECT balance FROM accounts WHERE account_number = ?`, [req.params.number], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "Not found" });
    res.json({ account_number: req.params.number, balance: row.balance });
  });
});

// 🔹 Add Transaction (auto-linked)
app.post("/transactions", (req, res) => {
  const { account_number, amount, description, related_module, related_id } = req.body;
  let type;

  if (related_module === "Invoice") type = "Incoming";
  else if (related_module === "Salary" || related_module === "Expense") type = "Outgoing";
  else type = "Transfer";

  const currentAcc = account_number;
  const capitalAcc = "CAP-001"; // Change to your actual capital account number

  if (type === "Outgoing") {
    autoTransferIfInsufficient(db, currentAcc, capitalAcc, amount, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      handleTransaction();
    });
  } else {
    handleTransaction();
  }

  function handleTransaction() {
    db.serialize(() => {
      if (type === "Incoming")
        db.run(`UPDATE accounts SET balance = balance + ? WHERE account_number = ?`, [amount, currentAcc]);
      else if (type === "Outgoing")
        db.run(`UPDATE accounts SET balance = balance - ? WHERE account_number = ?`, [amount, currentAcc]);

      db.run(
        `INSERT INTO transactions (account_number, type, description, amount, related_module, related_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [currentAcc, type, description, amount, related_module, related_id],
        function (err) {
          if (err) return res.status(400).json({ error: err.message });

          // Update related table
          if (related_module === "Salary") {
            db.run(`UPDATE monthly_salary_payments SET paid='Yes', paid_amount=?, paid_date=date('now') WHERE id=?`, [amount, related_id]);
          } else if (related_module === "Expense") {
            db.run(`UPDATE expense_payments SET status='Paid', paid_amount=?, paid_date=date('now') WHERE id=?`, [amount, related_id]);
          } else if (related_module === "Invoice") {
            db.run(`UPDATE invoices SET received='Yes', received_date=date('now') WHERE id=?`, [related_id]);
          }

          res.json({ message: "Transaction recorded", transaction_id: this.lastID });
        }
      );
    });
  }
});

// 🔹 Get Transaction History (Joined)
app.get("/transactions", (req, res) => {
  db.all(
    `
    SELECT t.transaction_id, t.account_number, t.type, t.amount, t.description,
           t.related_module, t.related_id, t.created_at,
           CASE
             WHEN t.related_module = 'Salary' THEN s.employee_name
             WHEN t.related_module = 'Expense' THEN e.type
             WHEN t.related_module = 'Invoice' THEN i.client_name
           END AS related_party
    FROM transactions t
    LEFT JOIN monthly_salary_payments s ON t.related_id = s.id AND t.related_module = 'Salary'
    LEFT JOIN expenses e ON t.related_id = e.auto_id AND t.related_module = 'Expense'
    LEFT JOIN invoices i ON t.related_id = i.id AND t.related_module = 'Invoice'
    ORDER BY t.created_at DESC
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});



// ✅ Create Account API
app.post("/accounts", (req, res) => {
  const { account_number, account_name, account_type, balance } = req.body;

  // Validate input
  if (!account_number || !account_name || !account_type) {
    return res.status(400).json({ error: "All fields are required" });
  }

  if (!["Capital", "Current"].includes(account_type)) {
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

// ✅ Create Account API
app.post("/accounts", (req, res) => {
  const { account_number, account_name, account_type, balance } = req.body;

  // Validate input
  if (!account_number || !account_name || !account_type) {
    return res.status(400).json({ error: "All fields are required" });
  }

  if (!["Capital", "Current"].includes(account_type)) {
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


// // PATCH: Add balance
// app.patch("/accounts/:number/add-balance", (req, res) => {
//   const { amount } = req.body;
//   const { number } = req.params;

//   if (!amount || amount <= 0)
//     return res.status(400).json({ error: "Invalid amount" });

//   db.run(
//     `UPDATE accounts SET balance = balance + ? WHERE account_number = ?`,
//     [amount, number],
//     function (err) {
//       if (err) return res.status(500).json({ error: err.message });
//       if (this.changes === 0)
//         return res.status(404).json({ error: "Account not found" });
//       res.json({ message: "Balance updated successfully" });
//     }
//   );
// });




// 🔹 Transfer money between accounts


// app.post("/accounts/transfer", (req, res) => {
//   const { from_account, to_account, amount, description } = req.body;

//   if (!from_account || !to_account || !amount || amount <= 0) {
//     return res.status(400).json({ error: "Invalid transfer details" });
//   }

//   if (from_account === to_account) {
//     return res.status(400).json({ error: "Cannot transfer to the same account" });
//   }});

// PATCH: Add balance
// app.patch("/accounts/:number/add-balance", (req, res) => {
//   const { amount } = req.body;
//   const { number } = req.params;

//   if (!amount || amount <= 0)
//     return res.status(400).json({ error: "Invalid amount" });

//   db.run(
//     `UPDATE accounts SET balance = balance + ? WHERE account_number = ?`,
//     [amount, number],
//     function (err) {
//       if (err) return res.status(500).json({ error: err.message });
//       if (this.changes === 0)
//         return res.status(404).json({ error: "Account not found" });
//       res.json({ message: "Balance updated successfully" });
//     }
//   );
// });


app.patch("/accounts/:number/add-balance", (req, res) => {
  const { amount, description } = req.body; // optional description
  const { number } = req.params;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  // Step 1: Get previous balance
  db.get(
    `SELECT balance FROM accounts WHERE account_number = ?`,
    [number],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Account not found" });

      const prevBalance = row.balance || 0;
      const newBalance = prevBalance + amount;

      // Step 2: Update balance
      db.run(
        `UPDATE accounts SET balance = ? WHERE account_number = ?`,
        [newBalance, number],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          if (this.changes === 0)
            return res.status(404).json({ error: "Account not found" });

          // Step 3: Generate custom transaction_id
          const now = new Date();
          const yyyy = now.getFullYear();
          const mm = String(now.getMonth() + 1).padStart(2, "0");
          const dd = String(now.getDate()).padStart(2, "0");
          const hh = String(now.getHours()).padStart(2, "0");
          const min = String(now.getMinutes()).padStart(2, "0");
          const ss = String(now.getSeconds()).padStart(2, "0");

          const transactionId = `crd/mnl/${yyyy}-${mm}-${dd}/${hh}:${min}:${ss}`;

          // Step 4: Insert into transactions table
          db.run(
            `INSERT INTO transactions 
              (transaction_id, account_number, type, description, amount, previous_balance, updated_balance, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [
              transactionId,
              number,
              "Credit",
              description || "Manual Credit",
              amount,
              prevBalance,
              newBalance,
            ],
            function (err3) {
              if (err3) {
                console.error("❌ Error inserting transaction:", err3.message);
                return res
                  .status(500)
                  .json({ error: "Balance updated but transaction failed" });
              }

              res.json({
                message:
                  "✅ Balance updated and transaction recorded successfully",
                transaction_id: transactionId,
              });
            }
          );
        }
      );
    }
  );
});


// 🔹 Transfer money between accounts
// app.post("/accounts/transfer", (req, res) => {
//   const { from_account, to_account, amount, description } = req.body;

//   if (!from_account || !to_account || !amount || amount <= 0) {
//     return res.status(400).json({ error: "Invalid transfer details" });
//   }

//   if (from_account === to_account) {
//     return res.status(400).json({ error: "Cannot transfer to the same account" });
//   }

//   db.serialize(() => {
//     // 1️⃣ Check balance of sender
//     db.get(
//       `SELECT balance FROM accounts WHERE account_number = ?`,
//       [from_account],
//       (err, sender) => {
//         if (err) return res.status(500).json({ error: err.message });
//         if (!sender) return res.status(404).json({ error: "Sender not found" });

//         if (sender.balance < amount) {
//           return res.status(400).json({ error: "Insufficient balance" });
//         }

//         // 2️⃣ Deduct from sender
//         db.run(
//           `UPDATE accounts SET balance = balance - ? WHERE account_number = ?`,
//           [amount, from_account],
//           function (err) {
//             if (err) return res.status(500).json({ error: err.message });

//             // 3️⃣ Add to receiver
//             db.run(
//               `UPDATE accounts SET balance = balance + ? WHERE account_number = ?`,
//               [amount, to_account],
//               function (err) {
//                 if (err) return res.status(500).json({ error: err.message });

//                 // 4️⃣ Record in transactions table for both
//                 const desc = description || `Transfer from ${from_account} to ${to_account}`;
//                 const now = new Date().toISOString();

//                 const stmt = db.prepare(`
//                   INSERT INTO transactions (account_number, type, description, amount, related_module, created_at)
//                   VALUES (?, ?, ?, ?, 'Transfer', ?)
//                 `);

//                 stmt.run(from_account, "Outgoing", desc, amount, now);
//                 stmt.run(to_account, "Incoming", desc, amount, now);
//                 stmt.finalize();

//                 res.json({
//                   message: "✅ Transfer successful",
//                   details: { from_account, to_account, amount },
//                 });
//               }
//             );
//           }
//         );
//       }
//     );
//   });
// });

// 🔹 Transfer money between two accounts (with transaction records)
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
      `SELECT balance FROM accounts WHERE account_number = ?`,
      [from_account],
      (err, sender) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!sender) return res.status(404).json({ error: "Sender not found" });

        if (sender.balance < amount) {
          return res.status(400).json({ error: "Insufficient balance" });
        }

        const senderPrev = sender.balance;
        const senderNew = senderPrev - amount;

        db.run(
          `UPDATE accounts SET balance = ? WHERE account_number = ?`,
          [senderNew, from_account],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });

            db.get(
              `SELECT balance FROM accounts WHERE account_number = ?`,
              [to_account],
              (err2, receiver) => {
                if (err2) return res.status(500).json({ error: err2.message });
                if (!receiver)
                  return res.status(404).json({ error: "Receiver not found" });

                const receiverPrev = receiver.balance;
                const receiverNew = receiverPrev + amount;

                db.run(
                  `UPDATE accounts SET balance = ? WHERE account_number = ?`,
                  [receiverNew, to_account],
                  function (err3) {
                    if (err3)
                      return res.status(500).json({ error: err3.message });

                    const now = new Date();
                    const yyyy = now.getFullYear();
                    const mm = String(now.getMonth() + 1).padStart(2, "0");
                    const dd = String(now.getDate()).padStart(2, "0");
                    const hh = String(now.getHours()).padStart(2, "0");
                    const min = String(now.getMinutes()).padStart(2, "0");
                    const ss = String(now.getSeconds()).padStart(2, "0");

                    const dateTime = `${yyyy}-${mm}-${dd}/${hh}:${min}:${ss}`;
                    const senderTransactionId = `deb/transf/${dateTime}`;
                    const receiverTransactionId = `crd/transf/${dateTime}`;

                    const desc =
                      description ||
                      `Transfer from ${from_account} to ${to_account}`;

                    // ✅ FIXED INSERT QUERY
                    const stmt = db.prepare(`
                      INSERT INTO transactions 
                      (transaction_id, account_number, type, description, amount, previous_balance, updated_balance, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    `);

                    stmt.run(
                      senderTransactionId,
                      from_account,
                      "Debit",
                      desc,
                      amount,
                      senderPrev,
                      senderNew
                    );
                    stmt.run(
                      receiverTransactionId,
                      to_account,
                      "Credit",
                      desc,
                      amount,
                      receiverPrev,
                      receiverNew
                    );
                    stmt.finalize();

                    res.json({
                      message: "✅ Transfer successful",
                      details: {
                        from_account,
                        to_account,
                        amount,
                        senderTransactionId,
                        receiverTransactionId,
                      },
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

// // -----------------------------------------------------------------------------
// // 📊 FORECAST ENDPOINT
// // -----------------------------------------------------------------------------
// // ----------------------------------------------------------------------------
// app.get("/forecast", async (req, res) => {
//   try {
//     console.log("📊 Forecast API Called");

//     const db = req.app.locals.db;
//     if (!db) throw new Error("Database not initialized");

//     const monthsAhead = parseInt(req.query.monthsAhead) || 6;
//     const monthsBackActuals = 24; // ✅ fetch past 2 years of actuals

//     // ---------------------------------------------------
//     // 🟢 1. ACTUAL INCOME (Invoices received)
//     // ---------------------------------------------------
//     const pastIncome = await runQuery(db, `
//       SELECT 
//         strftime('%Y-%m', received_date) AS month,
//         SUM(invoice_value + gst_amount) AS total_income
//       FROM invoices
//       WHERE received = 'Yes' AND received_date IS NOT NULL
//       GROUP BY month
//       ORDER BY month;
//     `);

//     // ---------------------------------------------------
//     // 🔵 2. FORECASTED INCOME (Active Projects)
//     // ---------------------------------------------------
//     const projects = await runQuery(db, `
//       SELECT 
//         startDate, 
//         endDate, 
//         netPayable, 
//         active, 
//         invoiceCycle
//       FROM Projects
//       WHERE active = 'Yes' AND netPayable IS NOT NULL;
//     `);

//     const today = new Date();
//     const futureIncomeMap = {};

//     for (let i = -monthsBackActuals; i < monthsAhead; i++) {
//       const m = new Date(today);
//       m.setMonth(today.getMonth() + i);
//       futureIncomeMap[m.toISOString().slice(0, 7)] = 0;
//     }

//     for (const p of projects) {
//       const start = p.startDate?.slice(0, 7);
//       const end = p.endDate?.slice(0, 7);
//       const monthlyBilling = Number(p.netPayable || 0);

//       for (const monthKey of Object.keys(futureIncomeMap)) {
//         if (!start || monthKey < start) continue;
//         if (end && monthKey > end) continue;

//         if (p.invoiceCycle === "Quarterly") {
//           const [sy, sm] = start.split("-").map(Number);
//           const [y, mo] = monthKey.split("-").map(Number);
//           const diff = (y - sy) * 12 + (mo - sm);
//           if (diff % 3 !== 0) continue;
//         }

//         futureIncomeMap[monthKey] += monthlyBilling;
//       }
//     }

//     const futureIncome = Object.entries(futureIncomeMap).map(([month, expected_income]) => ({
//       month,
//       expected_income,
//     }));

//     // ---------------------------------------------------
//     // 🔴 3. ACTUAL OUTGOING (Expenses + Paid Salaries)
//     // ---------------------------------------------------
//     const pastExpenses = await runQuery(db, `
//       SELECT 
//         strftime('%Y-%m', paid_date) AS month,
//         SUM(paid_amount) AS total_expense
//       FROM expense_payments
//       WHERE paid_date IS NOT NULL
//       GROUP BY month
//       ORDER BY month;
//     `);

//     const pastSalaries = await runQuery(db, `
//       SELECT 
//         strftime('%Y-%m', paid_date) AS month,
//         SUM(paid_amount) AS total_salaries
//       FROM monthly_salary_payments
//       WHERE paid = 'Yes' AND paid_date IS NOT NULL
//       GROUP BY month
//       ORDER BY month;
//     `);

//     console.log("✅ Actual salaries:", pastSalaries);
//     console.log("✅ Actual expenses:", pastExpenses);

//     // Merge actual expenses + salaries
//     const actualOutgoingMap = {};
//     const mergeActual = (data, field) => {
//       data.forEach((r) => {
//         if (!r.month) return;
//         if (!actualOutgoingMap[r.month]) actualOutgoingMap[r.month] = 0;
//         actualOutgoingMap[r.month] += Number(r[field] || 0);
//       });
//     };
//     mergeActual(pastExpenses, "total_expense");
//     mergeActual(pastSalaries, "total_salaries");

//     // ---------------------------------------------------
//     // 🟣 4. FORECASTED OUTGOING (Regular Expenses + Future Salaries)
//     // ---------------------------------------------------

//     // (A) Regular Recurring Expenses
//     const monthUnion = Array.from({ length: monthsAhead }, (_, i) => `SELECT ${i} AS n`).join(" UNION ");
//     const futureRegularExpenses = await runQuery(db, `
//       SELECT 
//         strftime('%Y-%m', date('now', '+' || n || ' month')) AS month,
//         SUM(amount) AS expected_expense
//       FROM expenses, (${monthUnion})
//       WHERE regular = 'Yes'
//       GROUP BY month;
//     `);

//     // (B) Forecasted Employee Salaries (using net_takehome, from joining date)
//     const salaryRecords = await runQuery(db, `
//       SELECT 
//         e.employee_id,
//         e.employee_name,
//         e.email,
//         e.active,
//         e.date_of_joining,
//         e.project_ending,
//         sp.month AS salary_month,
//         sp.gross_salary,
//         sp.net_takehome,
//         sp.paid,
//         sp.paid_date
//       FROM employees e
//       LEFT JOIN salary_payments sp 
//         ON LOWER(TRIM(e.employee_id)) = LOWER(TRIM(sp.employee_id))
//       WHERE LOWER(e.active) = 'yes'
//       ORDER BY e.employee_name;
//     `);

//     const latestSalaryMap = {};
//     salaryRecords.forEach((r) => {
//       if (!r.employee_id || !r.net_takehome) return;
//       const existing = latestSalaryMap[r.employee_id];
//       if (!existing || (r.salary_month && r.salary_month > existing.salary_month)) {
//         latestSalaryMap[r.employee_id] = {
//           employee_id: r.employee_id,
//           employee_name: r.employee_name,
//           email: r.email,
//           net_takehome: Number(r.net_takehome),
//           date_of_joining: r.date_of_joining,
//           project_ending: r.project_ending,
//         };
//       }
//     });

//     // Actual salary payments
//     const salaryPayments = await runQuery(db, `
//       SELECT 
//         LOWER(TRIM(employee_id)) AS employee_id,
//         strftime('%Y-%m', paid_date) AS month,
//         SUM(paid_amount) AS total_paid
//       FROM monthly_salary_payments
//       WHERE paid = 'Yes' AND paid_date IS NOT NULL
//       GROUP BY employee_id, month;
//     `);

//     const actualSalaryPaidMap = {};
//     salaryPayments.forEach((r) => {
//       if (!r.month) return;
//       if (!actualSalaryPaidMap[r.month]) actualSalaryPaidMap[r.month] = 0;
//       actualSalaryPaidMap[r.month] += Number(r.total_paid || 0);
//     });

//     // Build month range (past + future)
//     const startDate = new Date();
//     startDate.setMonth(startDate.getMonth() - monthsBackActuals);
//     const forecastMonthsArr = Array.from({ length: monthsAhead + monthsBackActuals }, (_, i) => {
//       const m = new Date(startDate);
//       m.setMonth(startDate.getMonth() + i);
//       return m.toISOString().slice(0, 7);
//     });

//     // Forecast salaries month-by-month
//     const forecastedSalaries = forecastMonthsArr.map((month) => {
//       const employees = Object.values(latestSalaryMap).filter((e) => {
//         if (!e.date_of_joining) return false;
//         const joinMonth = e.date_of_joining.slice(0, 7);
//         return joinMonth <= month;
//       });

//       const total_expected_salaries = employees.reduce(
//         (sum, emp) => sum + (emp.net_takehome || 0),
//         0
//       );

//       return { month, total_expected_salaries, employees };
//     });

//     // Merge forecasted salaries + regular expenses
//     const futureOutgoingMap = {};

//     // Add regular recurring expenses
//     futureRegularExpenses.forEach((r) => {
//       if (!r.month) return;
//       futureOutgoingMap[r.month] = (futureOutgoingMap[r.month] || 0) + (r.expected_expense || 0);
//     });

//     // Add forecasted salaries (skip already-paid months)
//     forecastedSalaries.forEach((s) => {
//       if (!s.month) return;
//       if (actualSalaryPaidMap[s.month]) return; // skip if already paid
//       futureOutgoingMap[s.month] = (futureOutgoingMap[s.month] || 0) + (s.total_expected_salaries || 0);
//     });

//     // Merge actual salaries into actualOutgoingMap
//     Object.entries(actualSalaryPaidMap).forEach(([month, total_paid]) => {
//       actualOutgoingMap[month] = (actualOutgoingMap[month] || 0) + total_paid;
//     });

//     const actualOutgoing = Object.entries(actualOutgoingMap).map(([month, amount]) => ({
//       month,
//       amount,
//     }));

//     const futureExpenses = Object.entries(futureOutgoingMap).map(([month, expected_expense]) => ({
//       month,
//       expected_expense,
//     }));

//     // ---------------------------------------------------
//     // 🧾 Final Response
//     // ---------------------------------------------------
//     res.json({
//       pastIncome,
//       futureIncome,
//       pastExpenses: actualOutgoing,
//       futureExpenses,
//       forecastedSalaries,
//     });

//     console.log("✅ Forecast Data Prepared Successfully", {
//       pastIncomeCount: pastIncome.length,
//       actualOutgoingCount: actualOutgoing.length,
//       futureIncomeCount: futureIncome.length,
//       futureExpensesCount: futureExpenses.length,
//     });
//   } catch (err) {
//     console.error("❌ Forecast API Error:", err);
//     res.status(500).json({
//       error: err.message,
//       pastIncome: [],
//       futureIncome: [],
//       pastExpenses: [],
//       futureExpenses: [],
//       forecastedSalaries: [],
//     });
//   }
// });





// // -----------------------------------------------------------------------------
// // 📈 MONTHLY SUMMARY ENDPOINT (unchanged except proper salary + project link)
// // -----------------------------------------------------------------------------
// app.get("/monthly-summary", async (req, res) => {
//   const db = req.app.locals.db;
//   const months = parseInt(req.query.months || "12", 10);
//   const forecastMonths = parseInt(req.query.forecast || "3", 10);

//   try {
//     const transRows = await runQuery(db, `
//       SELECT strftime('%Y-%m', created_at) as month,
//         SUM(CASE WHEN type='Credit' THEN amount ELSE 0 END) as credit_total,
//         SUM(CASE WHEN type='Debit' THEN amount ELSE 0 END) as debit_total
//       FROM transactions
//       GROUP BY month
//       ORDER BY month ASC
//       LIMIT ?
//     `, [months]);

//     const summaryMap = {};
//     transRows.forEach(r => {
//       const m = monthKey(r.month);
//       summaryMap[m] = {
//         month: m,
//         credit_total: Number(r.credit_total || 0),
//         debit_total: Number(r.debit_total || 0),
//       };
//     });

//     const creditArr = Object.values(summaryMap).map(r => r.credit_total);
//     const debitArr = Object.values(summaryMap).map(r => r.debit_total);

//     const futureCredits = linearRegressionForecast(creditArr, forecastMonths);
//     const futureDebits = linearRegressionForecast(debitArr, forecastMonths);

//     const lastMonth = Object.keys(summaryMap).sort().slice(-1)[0];
//     const futureMonths = [];
//     if (lastMonth) {
//       let [year, month] = lastMonth.split("-").map(Number);
//       for (let i = 0; i < forecastMonths; i++) {
//         month++;
//         if (month > 12) { month = 1; year++; }
//         futureMonths.push(`${year.toString().padStart(4,'0')}-${month.toString().padStart(2,'0')}`);
//       }
//     }

//     const projects = await runQuery(db, `
//       SELECT startDate, endDate, monthlyBilling, projectID
//       FROM Projects
//       WHERE active='Yes'
//     `);

//     const salaryRows = await runQuery(db, `
//       SELECT employee_id, strftime('%Y-%m', paid_date) as month, SUM(paid_amount) as paid
//       FROM monthly_salary_payments
//       GROUP BY employee_id, month
//     `);

//     const salariesMap = {};
//     salaryRows.forEach(s => {
//       if (!salariesMap[s.employee_id]) salariesMap[s.employee_id] = {};
//       salariesMap[s.employee_id][monthKey(s.month)] = Number(s.paid || 0);
//     });

//     futureMonths.forEach((m) => {
//       let projectIncome = 0;
//       let projectExpense = 0;

//       projects.forEach(p => {
//         const start = monthKey(p.startDate);
//         const end = monthKey(p.endDate);
//         if (start && end && m >= start && m <= end) {
//           projectIncome += Number(p.monthlyBilling || 0);
//           Object.keys(salariesMap).forEach(empId => {
//             if (salariesMap[empId][m]) projectExpense += salariesMap[empId][m];
//           });
//         }
//       });

//       summaryMap[m] = {
//         month: m,
//         credit_total: projectIncome,
//         debit_total: projectExpense,
//         forecast: true
//       };
//     });

//     const summary = Object.values(summaryMap).sort((a, b) => a.month.localeCompare(b.month));
//     res.json({ success: true, data: summary });

//   } catch (err) {
//     console.error("Error in /monthly-summary:", err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// });


// // -----------------------------------------------------------------------------
// // 🔥 Linear Regression Helper
// // -----------------------------------------------------------------------------
// function linearRegressionForecast(values, predictMonths = 3) {
//   const n = values.length;
//   if (n === 0) return Array(predictMonths).fill(0);

//   let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
//   for (let i = 0; i < n; i++) {
//     const x = i;
//     const y = values[i] || 0;
//     sumX += x; sumY += y; sumXX += x * x; sumXY += x * y;
//   }

//   const denom = n * sumXX - sumX * sumX;
//   let slope = 0, intercept = sumY / n;
//   if (denom !== 0) slope = (n * sumXY - sumX * sumY) / denom;

//   const results = [];
//   for (let k = 0; k < predictMonths; k++) {
//     const x = n + k;
//     let y = intercept + slope * x;
//     if (y < 0) y = 0;
//     results.push(Number(y.toFixed(2)));
//   }
//   return results;
// }



// ===============================
// FORECASTING API PACK
// ===============================

function runAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

// ===============================
// 🗓️ DAILY FORECAST
// ===============================
app.get("/api/forecast/daily", async (req, res) => {
  try {
    const start = req.query.start || "2024-01-01";
    const end = req.query.end || "2026-12-31";

    const sql = `
      WITH days AS (
        SELECT date(?) AS d
        UNION ALL
        SELECT date(d, '+1 day')
        FROM days
        WHERE date(d, '+1 day') <= date(?)
      ),
      actual_income AS (
        SELECT date(received_date) AS day, SUM(invoice_value) AS income
        FROM invoices
        WHERE received='Yes' AND received_date IS NOT NULL
        GROUP BY day
      ),
      actual_expenses AS (
        SELECT date(paid_date) AS day, SUM(actual_amount) AS expense
        FROM expense_payments
        WHERE paid_date IS NOT NULL
        GROUP BY day
      )
      SELECT
        d.d AS day,
        COALESCE(ai.income,0) AS actual_income,
        COALESCE(ae.expense,0) AS actual_expense,
        (COALESCE(ai.income,0) - COALESCE(ae.expense,0)) AS netflow
      FROM days d
      LEFT JOIN actual_income ai ON ai.day = d.d
      LEFT JOIN actual_expenses ae ON ae.day = d.d
      ORDER BY d.d;
    `;
    const rows = await runAll(sql, [start, end]);
    res.json(rows);
  } catch (err) {
    console.error("Daily Forecast Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 📅 WEEKLY FORECAST
// ===============================
// ===============================
// 📅 WEEKLY FORECAST
// ===============================
app.get("/api/forecast/weekly", async (req, res) => {
  try {
    const sql = `
      WITH actual_income AS (
        SELECT strftime('%Y-%W', received_date) AS week, SUM(invoice_value) AS income
        FROM invoices
        WHERE received='Yes' AND received_date IS NOT NULL
        GROUP BY week
      ),
      actual_expenses AS (
        SELECT strftime('%Y-%W', paid_date) AS week, SUM(actual_amount) AS expense
        FROM expense_payments
        WHERE paid_date IS NOT NULL
        GROUP BY week
      )
      SELECT
        ai.week AS week_key,
        COALESCE(ai.income,0) AS actual_income,
        COALESCE(ae.expense,0) AS actual_expense,
        (COALESCE(ai.income,0) - COALESCE(ae.expense,0)) AS netflow
      FROM actual_income ai
      LEFT JOIN actual_expenses ae ON ae.week = ai.week
      ORDER BY week_key;
    `;

    // ✅ no parameters needed — remove [start, end]
    const rows = await runAll(sql);
    res.json(rows);
  } catch (err) {
    console.error("Weekly Forecast Error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ===============================
// 📊 MONTHLY FORECAST (Advanced)
// ===============================
// ===============================
// 📊 MONTHLY FORECAST (Enhanced with 5 metrics)
// ===============================
app.get("/api/forecast/monthly", async (req, res) => {
  try {
    const start = req.query.start || "2024-01-01";
    const end = req.query.end || "2026-12-31";

    const sql = `
    WITH RECURSIVE months(m) AS (
      SELECT strftime('%Y-%m', date(?))
      UNION ALL
      SELECT strftime('%Y-%m', date(m || '-01', '+1 month'))
      FROM months
      WHERE date(m || '-01', '+1 month') <= date(?)
    ),

    -- 🧾 Actual Income (from invoices)
    actual_income AS (
      SELECT strftime('%Y-%m', received_date) AS month, SUM(invoice_value) AS income
      FROM invoices
      WHERE received='Yes' AND received_date IS NOT NULL
      GROUP BY month
    ),

    -- 💼 Forecasted Income (from projects)
    forecasted_income AS (
      SELECT
        p.projectID,
        strftime('%Y-%m', p.startDate) AS start_m,
        strftime('%Y-%m', p.endDate) AS end_m,
        p.netPayable,
        ((CAST(strftime('%Y', p.endDate) AS INTEGER) - CAST(strftime('%Y', p.startDate) AS INTEGER))*12 +
         (CAST(strftime('%m', p.endDate) AS INTEGER) - CAST(strftime('%m', p.startDate) AS INTEGER)) + 1) AS total_months
      FROM Projects p
      WHERE p.active='Yes'
    ),

    forecast_income_by_month AS (
      SELECT
        m.m AS month,
        SUM(
          CASE
            WHEN date(m.m || '-01') BETWEEN date(fi.start_m || '-01') AND date(fi.end_m || '-01')
            THEN fi.netPayable / fi.total_months
            ELSE 0
          END
        ) AS income
      FROM months m
      CROSS JOIN forecasted_income fi
      GROUP BY m.m
    ),

    -- 🧾 Actual Expense (salary + expense_payments)
    actual_salary AS (
      SELECT month, SUM(actual_to_pay) AS salary FROM monthly_salary_payments GROUP BY month
    ),
    actual_other_expense AS (
      SELECT month_year AS month, SUM(actual_amount) AS other_expense FROM expense_payments GROUP BY month_year
    ),
    actual_expense AS (
      SELECT
        m.m AS month,
        COALESCE(s.salary,0) + COALESCE(o.other_expense,0) AS expense
      FROM months m
      LEFT JOIN actual_salary s ON s.month = m.m
      LEFT JOIN actual_other_expense o ON o.month = m.m
    ),

    -- 🔮 Forecasted Expense (future months)
    recurring_expense AS (
      SELECT COALESCE(SUM(amount),0) AS recurring FROM expenses WHERE regular='Yes'
    ),

    forecasted_expense AS (
      SELECT
        m.m AS month,
        CASE WHEN m.m > strftime('%Y-%m','now')
          THEN (SELECT recurring FROM recurring_expense)
          ELSE 0
        END AS expense
      FROM months m
    )

    SELECT
      m.m AS month,
      COALESCE(ai.income,0) AS actual_income,
      COALESCE(fim.income,0) AS forecasted_income,
      COALESCE(ae.expense,0) AS actual_expense,
      COALESCE(fe.expense,0) AS forecasted_expense,
      (COALESCE(ai.income,0) - COALESCE(ae.expense,0)) AS actual_netflow,
      (COALESCE(fim.income,0) - COALESCE(fe.expense,0)) AS forecasted_netflow
    FROM months m
    LEFT JOIN actual_income ai ON ai.month = m.m
    LEFT JOIN forecast_income_by_month fim ON fim.month = m.m
    LEFT JOIN actual_expense ae ON ae.month = m.m
    LEFT JOIN forecasted_expense fe ON fe.month = m.m
    ORDER BY m.m;
    `;

    const rows = await runAll(sql, [start, end]);
    res.json(rows);
  } catch (err) {
    console.error("Forecast Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 📆 YEARLY FORECAST
// ===============================
app.get("/api/forecast/yearly", async (req, res) => {
  try {
    const sql = `
      WITH actual_income AS (
        SELECT strftime('%Y', received_date) AS year, SUM(invoice_value) AS income
        FROM invoices
        WHERE received='Yes' AND received_date IS NOT NULL
        GROUP BY year
      ),
      actual_expenses AS (
        SELECT strftime('%Y', paid_date) AS year, SUM(actual_amount) AS expense
        FROM expense_payments
        WHERE paid_date IS NOT NULL
        GROUP BY year
      )
      SELECT
        ai.year,
        COALESCE(ai.income,0) AS actual_income,
        COALESCE(ae.expense,0) AS actual_expense,
        (COALESCE(ai.income,0) - COALESCE(ae.expense,0)) AS netflow
      FROM actual_income ai
      LEFT JOIN actual_expenses ae ON ae.year = ai.year
      ORDER BY ai.year;
    `;
    const rows = await runAll(sql);
    res.json(rows);
  } catch (err) {
    console.error("Yearly Forecast Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 📈 FORECAST SUMMARY (Totals)
app.get("/api/forecast/summary", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // ✅ Validate
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "startDate and endDate are required" });
    }

    const sql = `
      SELECT
        -- 🟢 Actual income: invoices received within the selected period
        (SELECT SUM(invoice_value)
         FROM invoices
         WHERE received='Yes'
         AND invoice_date BETWEEN ? AND ?) AS total_actual_income,

        -- 🔵 Forecasted income: active projects overlapping the selected period
        (SELECT SUM(netPayable)
         FROM Projects
         WHERE active='Yes'
         AND (
            (start_date BETWEEN ? AND ?)
            OR (end_date BETWEEN ? AND ?)
            OR (? BETWEEN start_date AND end_date)
         )) AS total_forecast_income,

        -- 🔴 Actual expenses: salaries + expense payments during selected period
        (
          (SELECT SUM(actual_to_pay)
           FROM monthly_salary_payments
           WHERE payment_date BETWEEN ? AND ?)
          +
          (SELECT SUM(actual_amount)
           FROM expense_payments
           WHERE payment_date BETWEEN ? AND ?)
        ) AS total_actual_expense,

        -- 🟡 Recurring expenses (ongoing regular ones)
        (SELECT SUM(amount)
         FROM expenses
         WHERE regular='Yes') AS recurring_expense;
    `;

    const params = [
      startDate, endDate, // invoices
      startDate, endDate, startDate, endDate, startDate, // projects
      startDate, endDate, // salary payments
      startDate, endDate  // expense payments
    ];

    const [row] = await runAll(sql, params);

    row.netflow =
      (row.total_actual_income || 0) -
      ((row.total_actual_expense || 0) + (row.recurring_expense || 0));

    res.json(row);
  } catch (err) {
    console.error("Summary Forecast Error:", err);
    res.status(500).json({ error: err.message });
  }
});







app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});