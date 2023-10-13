const jwt = require("jsonwebtoken");
require("dotenv").config();

/**
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

//========JWT verify user helper function==========
async function checkUser(token) {
  return jwt.verify(token, process.env.JWT_SEC, async (err, decodedToken) => {
    if (err) {
      console.log("accounts check user err: ", err);
    } else if (decodedToken) {
      const user = await Users.findOne({ id: decodedToken.id });
      return user;
    }
  });
}
module.exports = {
  transactionpage: async function (req, res) {
    const transactions = await Accounts.find({ id: req.params.id }).populate(
      "transactions"
    );
    //==========Reversing the Transaction==========
    const transactionss = transactions[0].transactions.reverse();
    const memberWiseTransactions = [];

    if (transactionss) {
      const forUserbalance = transactions[0].transactions;
      for (const transaction of forUserbalance) {
        const tr = await Transaction.findOne({
          id: transaction.id,
        }).populate("owner");
        memberWiseTransactions.push(tr);
      }
    }

    const userBalances = new Map();

    // Helper function to update the balance in the map
    function updateBalance(userId, amount) {
      //========Create distinct user list with their balances with MAP==========
      if (!userBalances.has(userId)) {
        const owner = memberWiseTransactions.find(
          (transaction) => transaction.owner.id === userId
        ).owner;
        userBalances.set(userId, { name: owner.name, balance: 0 });
      }
      userBalances.get(userId).balance += amount;
    }
    // ==========Looping helper function on each fields===========
    memberWiseTransactions.forEach((transaction) => {
      const { owner, transactiontype, amount, transferto, transferfrom } =
        transaction;
      const ownerId = owner.id;

      if (transactiontype === "income") {
        updateBalance(ownerId, amount); // Credit
      } else if (transactiontype === "expense") {
        updateBalance(ownerId, -amount); // Debit
      } else if (transactiontype === "transfer") {
        updateBalance(ownerId, -amount); //Debit from sender's account
        if (transferto) {
          updateBalance(transferto, amount); //Credit in receiver's account
        }
      }
    });
    const userDetailsArray = Array.from(userBalances.values());

    //=========Total sum========
    const totalsum = memberWiseTransactions.reduce((sum, tr) => {
      if (tr.transactiontype == "expense") {
        sum -= tr.amount;
      } else if (tr.transactiontype == "income") {
        sum += tr.amount;
      }
      return sum;
    }, 0);

    //===========For Members List==========
    const members = await Accounts.find({ id: req.params.id }).populate(
      "members"
    );
    console.log("members[0].members: ", members[0].members.length);
    console.log("totalsum: ", totalsum);

    res.view("pages/transaction", {
      expenses: transactionss,
      members: members[0].members,
      accountid: req.params.id,
      userWiseAmount: userDetailsArray,
      totalsum: totalsum,
    });
  },
  //===========Create Transaction==========
  create: async function (req, res) {
    const { transactiontype, desc, amount } = req.body;

    try {
      const newTransaction = await Transaction.create({
        transactiontype,
        desc,
        amount,
      }).fetch();

      const createdBy = await checkUser(req.cookies.jwt);

      //===========Linking transaction between user and account==========
      await Accounts.addToCollection(
        req.params.ac,
        "transactions",
        newTransaction.id
      );
      await Users.addToCollection(
        createdBy.id,
        "indtransaction",
        newTransaction.id
      );
      res.redirect(`/transactions/${req.params.ac}`);
    } catch (err) {
      console.log("transaction create error", err);
      res.redirect(`/transactions/${req.params.ac}`);
      // res.status(400).json(err).redirect("/account");
    }
  },
  //===========Delete Transaction==========
  delete: async function (req, res) {
    try {
      const deletedTransations = await Transaction.destroyOne({
        id: req.params.id,
      });
      const createdBy = await checkUser(req.cookies.jwt);
      //===========Removin link between account and user==========
      await Accounts.removeFromCollection(
        req.params.ac,
        "transactions",
        req.params.id
      );
      await Users.removeFromCollection(
        createdBy.id,
        "indtransaction",
        newTransaction.id
      );
      res.redirect(`/transactions/${req.params.ac}`);
    } catch (err) {
      console.log("transaction delete error", err);
      res.redirect(`/transactions/${req.params.ac}`);
    }
  },
  //===========Edit Transaction==========
  edit: async function (req, res) {
    try {
      //===========Finding transaction and populate page with input values==========
      const transaction = await Transaction.findOne({ id: req.params.id });
      if (transaction) {
        res.view("pages/edittransaction", {
          expense: transaction,
          accountid: req.params.ac,
        });
      } else {
        //===========Edit transaction not found in db==========
        res.redirect(`/transactions/${req.params.ac}`);
      }
    } catch (err) {
      console.log("transaction edit error", err);
      res.redirect(`/transactions/${req.params.ac}`);
    }
  },
  //===========Update Transaction==========
  update: async function (req, res) {
    const data = req.body;

    try {
      const transaction = await Transaction.update({ id: req.params.id }, data);
      res.redirect(`/transactions/${req.params.ac}`);
    } catch (err) {
      console.log("transaction update error", err);
      res.redirect(`/transactions/${req.params.ac}`);
    }
  },
  //===========Adding new member==========
  addmember: async function (req, res) {
    try {
      const newMember = await Users.findOne({ email: req.body.memberemail });

      //===========Only registered memeber can be entered in account==========
      if (newMember) {
        //===========If found linking with particular account==========
        await Accounts.addToCollection(req.params.id, "members", newMember.id);
        res.redirect(`/transactions/${req.params.id}`);
      } else {
        console.log("Not a valid user...");
        res.redirect(`/transactions/${req.params.id}`);
      }
    } catch (err) {
      console.log("add member err", err);
      res.redirect(`/transactions/${req.params.id}`);
    }
  },
  //===========Transfer page==========
  transferpage: async function (req, res) {
    const account = await Accounts.findOne({ id: req.params.ac }).populate(
      "members"
    );
    const loggedInUser = await checkUser(req.cookies.jwt);

    //===========Removing logged in user from list because member can't transfer amount to ownself==========
    const members = account.members.filter(
      (member) => member.id != loggedInUser.id
    );

    res.view("pages/transfer", {
      members: members,
      accountid: req.params.ac,
    });
  },
  //===========Create transfer==========
  transfer: async function (req, res) {
    try {
      let { transfermember, amount } = req.body;
      transfermember = await Users.findOne({ id: transfermember });
      const createdBy = await checkUser(req.cookies.jwt);

      const newTransaction = await Transaction.create({
        transferto: transfermember.id,
        transferfrom: createdBy.id,
        amount,
        desc: `Transfer to ${transfermember.name}`,
        transactiontype: "transfer",
      }).fetch();

      //===========Linking with account and user==========
      await Accounts.addToCollection(
        req.params.ac,
        "transactions",
        newTransaction.id
      );
      await Users.addToCollection(
        createdBy.id,
        "indtransaction",
        newTransaction.id
      );
      res.redirect(`/transactions/${req.params.ac}`);
    } catch (err) {
      console.log("transfer err", err);
      res.redirect(`/transactions/${req.params.ac}`);
    }
  },
  //===========Edit transfer page==========
  edittransfer: async function (req, res) {
    const { id, ac } = req.params;
    try {
      const transaction = await Transaction.findOne({ id: id });
      const account = await Accounts.findOne({ id: ac }).populate("members");
      const loggedInUser = await checkUser(req.cookies.jwt);
      const members = account.members.filter(
        (member) => member.id != loggedInUser.id
      );

      res.view("pages/edittransfer", {
        members: members,
        tr: transaction,
        transactionid: id,
        accountid: req.params.ac,
      });
    } catch (err) {
      console.log("edit transfer err", err);
      //res.redirect(`/transactions/${ac}`);
    }
  },
  //===========Update transfer page==========
  updatetransfer: async function (req, res) {
    const data = req.body;

    try {
      const transaction = await Transaction.update({ id: req.params.id }, data);
      res.redirect(`/transactions/${req.params.ac}`);
    } catch (err) {
      console.log("transaction update error", err);
      res.redirect(`/transactions/${req.params.ac}`);
    }
  },
};
