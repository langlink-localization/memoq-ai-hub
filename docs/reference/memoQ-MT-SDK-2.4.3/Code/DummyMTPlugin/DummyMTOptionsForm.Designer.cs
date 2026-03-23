namespace DummyMTPlugin
{
    partial class DummyMTOptionsForm
    {
        /// <summary>
        /// Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows Form Designer generated code

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            this.lblUserName = new System.Windows.Forms.Label();
            this.lblPassword = new System.Windows.Forms.Label();
            this.tbUserName = new System.Windows.Forms.TextBox();
            this.tbPassword = new System.Windows.Forms.TextBox();
            this.btnOK = new System.Windows.Forms.Button();
            this.btnCancel = new System.Windows.Forms.Button();
            this.lnkRetrieveLangs = new System.Windows.Forms.LinkLabel();
            this.lbLanguages = new System.Windows.Forms.ListBox();
            this.progressBar = new System.Windows.Forms.ProgressBar();
            this.lblSupportedLanguages = new System.Windows.Forms.Label();
            this.btnHelp = new System.Windows.Forms.Button();
            this.cbFormattingTags = new System.Windows.Forms.ComboBox();
            this.lblTagsFormatting = new System.Windows.Forms.Label();
            this.btBrowse = new System.Windows.Forms.Button();
            this.tbLogFilePath = new System.Windows.Forms.TextBox();
            this.lbLogFilePath = new System.Windows.Forms.Label();
            this.SuspendLayout();
            // 
            // lblUserName
            // 
            this.lblUserName.Location = new System.Drawing.Point(8, 12);
            this.lblUserName.Name = "lblUserName";
            this.lblUserName.Size = new System.Drawing.Size(152, 16);
            this.lblUserName.TabIndex = 0;
            this.lblUserName.Text = "User name";
            // 
            // lblPassword
            // 
            this.lblPassword.Location = new System.Drawing.Point(8, 43);
            this.lblPassword.Name = "lblPassword";
            this.lblPassword.Size = new System.Drawing.Size(152, 16);
            this.lblPassword.TabIndex = 2;
            this.lblPassword.Text = "Password";
            // 
            // tbUserName
            // 
            this.tbUserName.Location = new System.Drawing.Point(168, 8);
            this.tbUserName.Name = "tbUserName";
            this.tbUserName.Size = new System.Drawing.Size(286, 20);
            this.tbUserName.TabIndex = 1;
            this.tbUserName.TextChanged += new System.EventHandler(this.tbUserNamePassword_TextChanged);
            // 
            // tbPassword
            // 
            this.tbPassword.Location = new System.Drawing.Point(168, 39);
            this.tbPassword.Name = "tbPassword";
            this.tbPassword.PasswordChar = '*';
            this.tbPassword.Size = new System.Drawing.Size(286, 20);
            this.tbPassword.TabIndex = 3;
            this.tbPassword.TextChanged += new System.EventHandler(this.tbUserNamePassword_TextChanged);
            // 
            // btnOK
            // 
            this.btnOK.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Bottom | System.Windows.Forms.AnchorStyles.Left)));
            this.btnOK.DialogResult = System.Windows.Forms.DialogResult.OK;
            this.btnOK.Location = new System.Drawing.Point(218, 299);
            this.btnOK.Name = "btnOK";
            this.btnOK.Size = new System.Drawing.Size(75, 23);
            this.btnOK.TabIndex = 8;
            this.btnOK.Text = "&OK";
            this.btnOK.UseVisualStyleBackColor = true;
            // 
            // btnCancel
            // 
            this.btnCancel.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Bottom | System.Windows.Forms.AnchorStyles.Left)));
            this.btnCancel.DialogResult = System.Windows.Forms.DialogResult.Cancel;
            this.btnCancel.Location = new System.Drawing.Point(298, 299);
            this.btnCancel.Name = "btnCancel";
            this.btnCancel.Size = new System.Drawing.Size(75, 23);
            this.btnCancel.TabIndex = 9;
            this.btnCancel.Text = "&Cancel";
            this.btnCancel.UseVisualStyleBackColor = true;
            // 
            // lnkRetrieveLangs
            // 
            this.lnkRetrieveLangs.Font = new System.Drawing.Font("Verdana", 8.25F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, ((byte)(238)));
            this.lnkRetrieveLangs.LinkBehavior = System.Windows.Forms.LinkBehavior.NeverUnderline;
            this.lnkRetrieveLangs.LinkColor = System.Drawing.Color.FromArgb(((int)(((byte)(0)))), ((int)(((byte)(0)))), ((int)(((byte)(192)))));
            this.lnkRetrieveLangs.Location = new System.Drawing.Point(8, 107);
            this.lnkRetrieveLangs.Name = "lnkRetrieveLangs";
            this.lnkRetrieveLangs.Size = new System.Drawing.Size(376, 20);
            this.lnkRetrieveLangs.TabIndex = 4;
            this.lnkRetrieveLangs.TabStop = true;
            this.lnkRetrieveLangs.Text = "Check login and retrieve language information";
            this.lnkRetrieveLangs.LinkClicked += new System.Windows.Forms.LinkLabelLinkClickedEventHandler(this.lnkRetrieveLangs_LinkClicked);
            // 
            // lbLanguages
            // 
            this.lbLanguages.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Bottom | System.Windows.Forms.AnchorStyles.Left)));
            this.lbLanguages.FormattingEnabled = true;
            this.lbLanguages.Location = new System.Drawing.Point(12, 185);
            this.lbLanguages.Name = "lbLanguages";
            this.lbLanguages.Size = new System.Drawing.Size(441, 108);
            this.lbLanguages.TabIndex = 6;
            // 
            // progressBar
            // 
            this.progressBar.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Bottom | System.Windows.Forms.AnchorStyles.Left)));
            this.progressBar.Location = new System.Drawing.Point(12, 305);
            this.progressBar.Name = "progressBar";
            this.progressBar.Size = new System.Drawing.Size(198, 12);
            this.progressBar.Style = System.Windows.Forms.ProgressBarStyle.Marquee;
            this.progressBar.TabIndex = 7;
            this.progressBar.Visible = false;
            // 
            // lblSupportedLanguages
            // 
            this.lblSupportedLanguages.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Bottom | System.Windows.Forms.AnchorStyles.Left)));
            this.lblSupportedLanguages.Location = new System.Drawing.Point(8, 165);
            this.lblSupportedLanguages.Name = "lblSupportedLanguages";
            this.lblSupportedLanguages.Size = new System.Drawing.Size(376, 16);
            this.lblSupportedLanguages.TabIndex = 5;
            this.lblSupportedLanguages.Text = "Supported languages";
            // 
            // btnHelp
            // 
            this.btnHelp.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Bottom | System.Windows.Forms.AnchorStyles.Left)));
            this.btnHelp.Location = new System.Drawing.Point(378, 299);
            this.btnHelp.Name = "btnHelp";
            this.btnHelp.Size = new System.Drawing.Size(75, 23);
            this.btnHelp.TabIndex = 10;
            this.btnHelp.Text = "&Help";
            this.btnHelp.UseVisualStyleBackColor = true;
            this.btnHelp.Click += new System.EventHandler(this.btnHelp_Click);
            // 
            // cbFormattingTags
            // 
            this.cbFormattingTags.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.cbFormattingTags.FormattingEnabled = true;
            this.cbFormattingTags.Location = new System.Drawing.Point(168, 127);
            this.cbFormattingTags.Name = "cbFormattingTags";
            this.cbFormattingTags.Size = new System.Drawing.Size(286, 21);
            this.cbFormattingTags.TabIndex = 11;
            // 
            // lblTagsFormatting
            // 
            this.lblTagsFormatting.Location = new System.Drawing.Point(8, 131);
            this.lblTagsFormatting.Name = "lblTagsFormatting";
            this.lblTagsFormatting.Size = new System.Drawing.Size(152, 16);
            this.lblTagsFormatting.TabIndex = 12;
            this.lblTagsFormatting.Text = "Tags and formatting";
            // 
            // btBrowse
            // 
            this.btBrowse.Location = new System.Drawing.Point(378, 68);
            this.btBrowse.Name = "btBrowse";
            this.btBrowse.Size = new System.Drawing.Size(75, 23);
            this.btBrowse.TabIndex = 15;
            this.btBrowse.Text = "Browse";
            this.btBrowse.UseVisualStyleBackColor = true;
            this.btBrowse.Click += new System.EventHandler(this.btBrowse_Click);
            // 
            // tbLogFilePath
            // 
            this.tbLogFilePath.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left) 
            | System.Windows.Forms.AnchorStyles.Right)));
            this.tbLogFilePath.Location = new System.Drawing.Point(168, 70);
            this.tbLogFilePath.Name = "tbLogFilePath";
            this.tbLogFilePath.Size = new System.Drawing.Size(204, 20);
            this.tbLogFilePath.TabIndex = 14;
            // 
            // lbLogFilePath
            // 
            this.lbLogFilePath.AutoSize = true;
            this.lbLogFilePath.Location = new System.Drawing.Point(8, 73);
            this.lbLogFilePath.Name = "lbLogFilePath";
            this.lbLogFilePath.Size = new System.Drawing.Size(81, 13);
            this.lbLogFilePath.TabIndex = 13;
            this.lbLogFilePath.Text = "Log file location";
            // 
            // DummyMTOptionsForm
            // 
            this.AcceptButton = this.btnOK;
            this.AutoScaleDimensions = new System.Drawing.SizeF(6F, 13F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            this.CancelButton = this.btnCancel;
            this.ClientSize = new System.Drawing.Size(461, 330);
            this.Controls.Add(this.btBrowse);
            this.Controls.Add(this.tbLogFilePath);
            this.Controls.Add(this.lbLogFilePath);
            this.Controls.Add(this.lblTagsFormatting);
            this.Controls.Add(this.cbFormattingTags);
            this.Controls.Add(this.btnHelp);
            this.Controls.Add(this.lblSupportedLanguages);
            this.Controls.Add(this.progressBar);
            this.Controls.Add(this.lbLanguages);
            this.Controls.Add(this.lnkRetrieveLangs);
            this.Controls.Add(this.btnCancel);
            this.Controls.Add(this.btnOK);
            this.Controls.Add(this.tbPassword);
            this.Controls.Add(this.tbUserName);
            this.Controls.Add(this.lblPassword);
            this.Controls.Add(this.lblUserName);
            this.FormBorderStyle = System.Windows.Forms.FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.Name = "DummyMTOptionsForm";
            this.ShowIcon = false;
            this.ShowInTaskbar = false;
            this.Text = "Dummy MT plugin settings";
            this.FormClosing += new System.Windows.Forms.FormClosingEventHandler(this.DummyMTOptionsForm_FormClosing);
            this.ResumeLayout(false);
            this.PerformLayout();

        }

        #endregion

        private System.Windows.Forms.Label lblUserName;
        private System.Windows.Forms.Label lblPassword;
        private System.Windows.Forms.TextBox tbUserName;
        private System.Windows.Forms.TextBox tbPassword;
        private System.Windows.Forms.Button btnOK;
        private System.Windows.Forms.Button btnCancel;
        private System.Windows.Forms.LinkLabel lnkRetrieveLangs;
        private System.Windows.Forms.ListBox lbLanguages;
        private System.Windows.Forms.ProgressBar progressBar;
        private System.Windows.Forms.Label lblSupportedLanguages;
        private System.Windows.Forms.Button btnHelp;
        private System.Windows.Forms.ComboBox cbFormattingTags;
        private System.Windows.Forms.Label lblTagsFormatting;
        private System.Windows.Forms.Button btBrowse;
        private System.Windows.Forms.TextBox tbLogFilePath;
        private System.Windows.Forms.Label lbLogFilePath;
    }
}